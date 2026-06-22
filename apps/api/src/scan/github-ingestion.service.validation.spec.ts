import {
  GitHubIngestionService,
  GitHubIngestionError,
  type IngestionErrorKind,
  type ParsedRepo,
} from "./github-ingestion.service.js";

/**
 * Example-based validation tables for GitHubIngestionService.validateUrl and
 * validateRef.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 11.1
 */
describe("GitHubIngestionService validation", () => {
  // Construct with an explicit config so the test never depends on process.env.
  const service = new GitHubIngestionService({
    maxRepoBytes: 100 * 1024 * 1024,
    maxFileCount: 5000,
    fetchTimeoutMs: 60_000,
    fetchMechanism: "tarball",
  });

  describe("validateUrl", () => {
    type AcceptRow = {
      name: string;
      url: string;
      owner: string;
      repo: string;
      ref?: string;
    };

    const acceptRows: AcceptRow[] = [
      {
        name: "valid HTTPS repo URL",
        url: "https://github.com/owner/repo",
        owner: "owner",
        repo: "repo",
        ref: undefined,
      },
      {
        name: "URL with .git suffix",
        url: "https://github.com/owner/repo.git",
        owner: "owner",
        repo: "repo",
        ref: undefined,
      },
      {
        name: "/tree/<branch> extracts ref",
        url: "https://github.com/owner/repo/tree/main",
        owner: "owner",
        repo: "repo",
        ref: "main",
      },
      {
        name: "/tree/<branch> with slash in ref",
        url: "https://github.com/owner/repo/tree/feature/x",
        owner: "owner",
        repo: "repo",
        ref: "feature/x",
      },
      {
        name: "/commit/<sha> extracts ref",
        url: "https://github.com/owner/repo/commit/abc123def456",
        owner: "owner",
        repo: "repo",
        ref: "abc123def456",
      },
    ];

    it.each(acceptRows)("accepts $name", ({ url, owner, repo, ref }) => {
      const parsed: ParsedRepo = service.validateUrl(url);
      expect(parsed.owner).toBe(owner);
      expect(parsed.repo).toBe(repo);
      expect(parsed.ref).toBe(ref);
    });

    type RejectRow = {
      name: string;
      url: string;
      kind: IngestionErrorKind;
    };

    const rejectRows: RejectRow[] = [
      {
        name: "SSH form",
        url: "git@github.com:owner/repo.git",
        kind: "invalid-url",
      },
      {
        name: "file:// scheme",
        url: "file:///etc/passwd",
        kind: "invalid-url",
      },
      {
        name: "ftp:// scheme",
        url: "ftp://github.com/owner/repo",
        kind: "invalid-url",
      },
      {
        name: "other host (gitlab)",
        url: "https://gitlab.com/o/r",
        kind: "invalid-url",
      },
      {
        name: "userinfo trick (github.com@evil.com)",
        url: "https://github.com@evil.com/owner/repo",
        kind: "invalid-url",
      },
      {
        name: "missing repo segment",
        url: "https://github.com/owner",
        kind: "not-a-repo-url",
      },
    ];

    it.each(rejectRows)("rejects $name", ({ url, kind }) => {
      let thrown: unknown;
      try {
        service.validateUrl(url);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(GitHubIngestionError);
      expect((thrown as GitHubIngestionError).kind).toBe(kind);
    });
  });

  describe("validateRef", () => {
    const validRefs = ["main", "feature/x", "v1.2.3"];

    it.each(validRefs)("accepts valid ref %s", (ref) => {
      expect(service.validateRef(ref)).toBe(ref);
    });

    const invalidRefs = ["..", "a b", "-x", "x.lock", "re~f"];

    it.each(invalidRefs)("rejects invalid ref %s", (ref) => {
      let thrown: unknown;
      try {
        service.validateRef(ref);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(GitHubIngestionError);
      expect((thrown as GitHubIngestionError).kind).toBe("invalid-ref");
    });

    it("returns undefined for empty/undefined ref (default branch)", () => {
      expect(service.validateRef(undefined)).toBeUndefined();
      expect(service.validateRef("")).toBeUndefined();
    });
  });
});
