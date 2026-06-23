// Feature: production-grade-system, Property 10: Repository URL allowlist
//
// Property 10: Repository URL allowlist
// **Validates: Requirements 4.1, 4.2, 4.11**
//
// For any candidate Repository_URL, the GitHub_Ingestion_Service accepts it if
// and only if its scheme is `https` AND its host is exactly `github.com` (with
// a non-empty owner/repo extractable from the path), rejecting every other
// scheme, every other host, userinfo tricks (e.g. https://github.com@evil.com),
// and internal/SSRF targets (localhost, 127.0.0.1, 169.254.169.254, RFC-1918
// hosts, *.internal, etc.). All rejections raise a GitHubIngestionError.

import "reflect-metadata";
import fc from "fast-check";
import {
  GitHubIngestionService,
  GitHubIngestionError,
  type ParsedRepo,
} from "./github-ingestion.service.js";

/**
 * Independent oracle re-expressing the allowlist condition from Requirements
 * 4.1/4.2/4.11 rather than importing the service internals, so a regression in
 * the service cannot silently move the expected answer with it.
 *
 * Accept iff:
 *   - the string parses as a URL,
 *   - scheme is exactly `https`,
 *   - host (host, not just hostname) is exactly `github.com`,
 *   - a non-empty owner + repo (with a trailing `.git` stripped) can be
 *     extracted from the first two path segments.
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

/** GitHub owner/repo name alphabet. */
const nameChars =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
const validNameArb = fc
  .array(fc.constantFrom(...nameChars.split("")), {
    minLength: 1,
    maxLength: 20,
  })
  .map((chars) => chars.join(""))
  // Exclude names that strip to empty (e.g. ".git") or all-dot segments that
  // URL path-normalization would rewrite ("." / ".." etc.).
  .filter(
    (s) =>
      s.replace(/\.git$/i, "").length > 0 &&
      s !== "." &&
      s !== ".." &&
      !/^\.+$/.test(s),
  );

/** Well-formed, acceptable https://github.com/<owner>/<repo> URLs. */
const validUrlArb = fc
  .record({
    owner: validNameArb,
    repo: validNameArb,
    dotGit: fc.boolean(),
  })
  .map(
    ({ owner, repo, dotGit }) =>
      `https://github.com/${owner}/${repo}${dotGit ? ".git" : ""}`,
  );

/** Internal / SSRF target hosts that must always be rejected (Req 4.11). */
const ssrfHosts = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "169.254.169.254", // cloud instance metadata endpoint
  "10.0.0.5",
  "192.168.1.1",
  "172.16.0.1",
  "metadata.google.internal",
  "internal.service.local",
  "::1",
  "[::1]",
];

/** Disallowed hosts: lookalikes plus SSRF/internal targets. */
const disallowedHostArb = fc.constantFrom(
  "evil.com",
  "raw.githubusercontent.com",
  "github.com.attacker.com",
  "notgithub.com",
  "gist.github.com",
  ...ssrfHosts,
);

/** Adversarial / rejectable URLs covering schemes, hosts, userinfo, SSRF. */
const adversarialUrlArb = fc.oneof(
  // Disallowed schemes against the real host (Req 4.2)
  fc
    .record({
      scheme: fc.constantFrom("http", "ftp", "ssh", "file", "git", "ws"),
      owner: validNameArb,
      repo: validNameArb,
    })
    .map(({ scheme, owner, repo }) => `${scheme}://github.com/${owner}/${repo}`),
  // Disallowed / internal / SSRF hosts over https (Req 4.2, 4.11)
  fc
    .record({ host: disallowedHostArb, owner: validNameArb, repo: validNameArb })
    .map(({ host, owner, repo }) => `https://${host}/${owner}/${repo}`),
  // Userinfo trick: github.com is the username, real host is something else
  fc
    .record({
      host: disallowedHostArb,
      owner: validNameArb,
      repo: validNameArb,
    })
    .map(
      ({ host, owner, repo }) =>
        `https://github.com@${host}/${owner}/${repo}`,
    ),
  // SSH scp-like form (unparseable as URL)
  fc
    .record({ owner: validNameArb, repo: validNameArb })
    .map(({ owner, repo }) => `git@github.com:${owner}/${repo}.git`),
  // Missing repo segment / bare host
  validNameArb.map((owner) => `https://github.com/${owner}`),
  fc.constant("https://github.com"),
  // Garbage / non-URLs
  fc.constantFrom(
    "/etc/passwd",
    "not a url",
    "://github.com/a/b",
    "https://github.com//",
  ),
);

describe("GitHubIngestionService.validateUrl — Property 10: Repository URL allowlist", () => {
  const service = new GitHubIngestionService({
    maxRepoBytes: 1024,
    maxFileCount: 10,
    fetchTimeoutMs: 1000,
    fetchMechanism: "tarball",
  });

  function runValidate(rawUrl: string): {
    accepted: boolean;
    parsed?: ParsedRepo;
    error?: unknown;
  } {
    try {
      return { accepted: true, parsed: service.validateUrl(rawUrl) };
    } catch (error) {
      return { accepted: false, error };
    }
  }

  it("accepts iff https + github.com + extractable owner/repo, across mixed inputs", () => {
    fc.assert(
      fc.property(
        fc.oneof(validUrlArb, adversarialUrlArb, fc.string()),
        (rawUrl) => {
          const expected = classifyExpected(rawUrl);
          const actual = runValidate(rawUrl);

          expect(actual.accepted).toBe(expected.accept);

          if (expected.accept) {
            expect(actual.parsed).toBeDefined();
            expect(actual.parsed!.owner).toBe(expected.owner);
            expect(actual.parsed!.repo).toBe(expected.repo);
            expect(actual.parsed!.owner.length).toBeGreaterThan(0);
            expect(actual.parsed!.repo.length).toBeGreaterThan(0);
          } else {
            expect(actual.error).toBeInstanceOf(GitHubIngestionError);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("always rejects internal / SSRF target hosts with GitHubIngestionError", () => {
    const ssrfUrlArb = fc
      .record({
        host: fc.constantFrom(...ssrfHosts),
        owner: validNameArb,
        repo: validNameArb,
      })
      .map(({ host, owner, repo }) => `https://${host}/${owner}/${repo}`);

    fc.assert(
      fc.property(ssrfUrlArb, (rawUrl) => {
        // Sanity: the oracle agrees these are rejectable.
        expect(classifyExpected(rawUrl).accept).toBe(false);
        expect(() => service.validateUrl(rawUrl)).toThrow(GitHubIngestionError);
      }),
      { numRuns: 150 },
    );
  });

  it("always rejects userinfo tricks that smuggle a non-github host", () => {
    const userinfoUrlArb = fc
      .record({
        host: disallowedHostArb,
        owner: validNameArb,
        repo: validNameArb,
      })
      .map(
        ({ host, owner, repo }) =>
          `https://github.com@${host}/${owner}/${repo}`,
      )
      .filter((u) => !classifyExpected(u).accept);

    fc.assert(
      fc.property(userinfoUrlArb, (rawUrl) => {
        expect(() => service.validateUrl(rawUrl)).toThrow(GitHubIngestionError);
      }),
      { numRuns: 150 },
    );
  });

  it("always accepts well-formed https github.com repository URLs", () => {
    fc.assert(
      fc.property(validUrlArb, (rawUrl) => {
        const parsed = service.validateUrl(rawUrl);
        expect(parsed.owner.length).toBeGreaterThan(0);
        expect(parsed.repo.length).toBeGreaterThan(0);
      }),
      { numRuns: 150 },
    );
  });
});
