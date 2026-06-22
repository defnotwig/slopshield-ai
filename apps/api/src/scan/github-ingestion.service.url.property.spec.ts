// Feature: github-repository-scanner, Property 1
import "reflect-metadata";
import fc from "fast-check";
import {
  GitHubIngestionService,
  GitHubIngestionError,
  type ParsedRepo,
} from "./github-ingestion.service";

/**
 * Property 1: URL allowlist safety
 *
 * For any string URL, `validateUrl` accepts it (returning a ParsedRepo with a
 * non-empty owner/repo) IF AND ONLY IF its scheme is exactly `https`, its host
 * is exactly `github.com`, and a non-empty owner and repo can be extracted from
 * the path. Every other input is rejected with a GitHubIngestionError.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6
 */

/**
 * Independent oracle that decides whether a raw URL should be ACCEPTED by the
 * allowlist, mirroring the documented allowlist condition:
 *   - parseable URL
 *   - scheme exactly `https`
 *   - host exactly `github.com`
 *   - non-empty owner + repo extractable from the path (repo `.git` stripped)
 */
function classifyExpected(rawUrl: string): {
  accept: boolean;
  owner?: string;
  repo?: string;
} {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { accept: false };
  }
  if (url.protocol !== "https:") return { accept: false };
  if (url.host.toLowerCase() !== "github.com") return { accept: false };

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return { accept: false };

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  const NAME = /^[A-Za-z0-9._-]+$/;
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) {
    return { accept: false };
  }
  return { accept: true, owner, repo };
}

/** A single segment using only GitHub's allowed owner/repo name characters. */
const nameChars =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
const validNameArb = fc
  .array(fc.constantFrom(...nameChars.split("")), {
    minLength: 1,
    maxLength: 20,
  })
  .map((chars) => chars.join(""))
  // exclude names that strip to empty (e.g. ".git") which the parser rejects,
  // and names that URL path-normalization would rewrite (".", "..", or any
  // all-dots segment), which would not survive `new URL()` intact.
  .filter(
    (s) =>
      s.replace(/\.git$/i, "").length > 0 &&
      s.length > 0 &&
      s !== "." &&
      s !== ".." &&
      !/^\.+$/.test(s),
  );

/** Arbitrary that produces well-formed, acceptable github.com https URLs. */
const validUrlArb = fc
  .record({
    owner: validNameArb,
    repo: validNameArb,
    dotGit: fc.boolean(),
    refSuffix: fc.option(
      fc.tuple(
        fc.constantFrom("tree", "commit"),
        fc
          .array(fc.constantFrom(...nameChars.split("")), {
            minLength: 1,
            maxLength: 10,
          })
          .map((c) => c.join("")),
      ),
      { nil: undefined },
    ),
  })
  .map(({ owner, repo, dotGit, refSuffix }) => {
    let path = `/${owner}/${repo}${dotGit ? ".git" : ""}`;
    if (refSuffix) path += `/${refSuffix[0]}/${refSuffix[1]}`;
    return `https://github.com${path}`;
  });

/** Arbitrary that produces adversarial / rejectable URLs. */
const adversarialUrlArb = fc.oneof(
  // Disallowed schemes (Req 2.2)
  fc
    .record({
      scheme: fc.constantFrom("http", "ftp", "ssh", "file", "git"),
      owner: validNameArb,
      repo: validNameArb,
    })
    .map(
      ({ scheme, owner, repo }) => `${scheme}://github.com/${owner}/${repo}`,
    ),
  // Disallowed hosts incl. lookalikes and userinfo tricks (Req 2.3)
  fc
    .record({
      host: fc.constantFrom(
        "evil.com",
        "raw.githubusercontent.com",
        "github.com.attacker.com",
        "githubXcom",
        "notgithub.com",
      ),
      owner: validNameArb,
      repo: validNameArb,
    })
    .map(({ host, owner, repo }) => `https://${host}/${owner}/${repo}`),
  // Userinfo trick: github.com is the username, real host is evil.com
  fc
    .record({ owner: validNameArb, repo: validNameArb })
    .map(({ owner, repo }) => `https://github.com@evil.com/${owner}/${repo}`),
  // SSH scp-like form (Req 2.4)
  fc
    .record({ owner: validNameArb, repo: validNameArb })
    .map(({ owner, repo }) => `git@github.com:${owner}/${repo}.git`),
  // Missing repo segment (Req 2.6)
  validNameArb.map((owner) => `https://github.com/${owner}`),
  // Bare host, no path
  fc.constant("https://github.com"),
  // file path / garbage
  fc.constantFrom(
    "/etc/passwd",
    "not a url",
    "://github.com/a/b",
    "https://github.com//",
  ),
);

describe("GitHubIngestionService.validateUrl — Property 1: URL allowlist safety", () => {
  const service = new GitHubIngestionService({
    maxRepoBytes: 1024,
    maxFileCount: 10,
    fetchTimeoutMs: 1000,
    fetchMechanism: "tarball",
  });

  /** Run validateUrl and report whether it accepted (and the parsed result). */
  function runValidate(rawUrl: string): {
    accepted: boolean;
    parsed?: ParsedRepo;
    error?: unknown;
  } {
    try {
      const parsed = service.validateUrl(rawUrl);
      return { accepted: true, parsed };
    } catch (error) {
      return { accepted: false, error };
    }
  }

  it("accepts iff https + github.com + extractable owner/repo (mixed inputs)", () => {
    fc.assert(
      fc.property(
        fc.oneof(validUrlArb, adversarialUrlArb, fc.string()),
        (rawUrl) => {
          const expected = classifyExpected(rawUrl);
          const actual = runValidate(rawUrl);

          // accept ⇔ allowlist condition holds
          expect(actual.accepted).toBe(expected.accept);

          if (expected.accept) {
            // Accepted: returns a ParsedRepo with non-empty owner/repo
            expect(actual.parsed).toBeDefined();
            expect(actual.parsed!.owner).toBe(expected.owner);
            expect(actual.parsed!.repo).toBe(expected.repo);
            expect(actual.parsed!.owner.length).toBeGreaterThan(0);
            expect(actual.parsed!.repo.length).toBeGreaterThan(0);
          } else {
            // Rejected: always a GitHubIngestionError
            expect(actual.error).toBeInstanceOf(GitHubIngestionError);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("always accepts well-formed github.com https URLs", () => {
    fc.assert(
      fc.property(validUrlArb, (rawUrl) => {
        const parsed = service.validateUrl(rawUrl);
        expect(parsed.owner.length).toBeGreaterThan(0);
        expect(parsed.repo.length).toBeGreaterThan(0);
      }),
      { numRuns: 150 },
    );
  });

  it("always rejects adversarial schemes/hosts/forms with GitHubIngestionError", () => {
    fc.assert(
      fc.property(adversarialUrlArb, (rawUrl) => {
        // Only assert rejection for inputs the oracle agrees are rejectable,
        // guarding against any adversarial generator that happens to be valid.
        if (classifyExpected(rawUrl).accept) return;
        expect(() => service.validateUrl(rawUrl)).toThrow(GitHubIngestionError);
      }),
      { numRuns: 150 },
    );
  });
});
