// Feature: github-repository-scanner, Property 13
import "reflect-metadata";
import fc from "fast-check";
import { Readable } from "node:stream";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as tar from "tar";
import {
  GitHubIngestionService,
  GitHubIngestionError,
  type IngestionErrorKind,
} from "./github-ingestion.service";
import type { GitHubIngestionConfig } from "./github-ingestion.config";

/**
 * Property 13: Cleanup-on-failure safety
 *
 * For any ingestion failure kind (invalid-url, not-a-repo-url, invalid-ref,
 * not-found, private-no-token, too-large, too-many-files, timeout,
 * network-error), after `ingest()` handles the failure the per-scan `scanDir`
 * does NOT exist — no partial temporary files are left behind.
 *
 * Validates: Requirements 11.5
 */

/** The nine discriminated failure kinds the service can surface. */
const KINDS: IngestionErrorKind[] = [
  "invalid-url",
  "not-a-repo-url",
  "invalid-ref",
  "not-found",
  "private-no-token",
  "too-large",
  "too-many-files",
  "timeout",
  "network-error",
];

/** Build a web ReadableStream from a Node Buffer, mirroring `Response.body`. */
function webStreamFromBuffer(buf: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    Readable.from([buf]),
  ) as unknown as ReadableStream<Uint8Array>;
}

/** Minimal Response-like object with the given status and optional body. */
function fakeResponse(status: number, body?: Buffer): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: body ? webStreamFromBuffer(body) : null,
  } as unknown as Response;
}

const BASE_CONFIG: GitHubIngestionConfig = {
  maxRepoBytes: 100 * 1024 * 1024,
  maxFileCount: 5000,
  fetchTimeoutMs: 5000,
  fetchMechanism: "tarball",
};

/**
 * Inputs that drive `ingest()` into the requested failure kind:
 *  - rawUrl / ref: arguments passed straight to ingest()
 *  - config: per-kind overrides (token, caps)
 *  - fetch: how the mocked global fetch should behave (or undefined when the
 *    failure is raised before fetch is ever called)
 */
interface FailureSetup {
  rawUrl: string;
  ref: string | undefined;
  config: GitHubIngestionConfig;
  fetch?: () => unknown;
}

describe("GitHubIngestionService.ingest — Property 13: Cleanup-on-failure safety", () => {
  let workRoot: string;
  /** A real, valid gzipped tarball (one small text file) reused per iteration. */
  let tarballBytes: Buffer;
  let fetchSpy: jest.SpyInstance | undefined;

  beforeAll(() => {
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ss-cleanup-"));

    // Build a well-formed GitHub-style tarball: a single top-level folder
    // (stripped by safeExtract) containing one non-excluded source file.
    const srcDir = path.join(workRoot, "src");
    const topDir = path.join(srcDir, "repo-main");
    fs.mkdirSync(topDir, { recursive: true });
    fs.writeFileSync(path.join(topDir, "index.ts"), "export const x = 1;\n");

    const tgzPath = path.join(workRoot, "repo.tgz");
    tar.c({ gzip: true, cwd: srcDir, file: tgzPath, sync: true }, [
      "repo-main/index.ts",
    ]);
    tarballBytes = fs.readFileSync(tgzPath);
  });

  afterAll(() => {
    fs.rmSync(workRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.mockRestore();
      fetchSpy = undefined;
    }
  });

  /** Map a failure kind to the inputs that deterministically trigger it. */
  function setupFor(kind: IngestionErrorKind): FailureSetup {
    switch (kind) {
      // Raised synchronously in validateUrl — fetch is never reached.
      case "invalid-url":
        return {
          rawUrl: "ftp://github.com/owner/repo",
          ref: undefined,
          config: BASE_CONFIG,
        };
      case "not-a-repo-url":
        return {
          rawUrl: "https://github.com/owneronly",
          ref: undefined,
          config: BASE_CONFIG,
        };
      // Raised in validateRef for an otherwise-valid URL.
      case "invalid-ref":
        return {
          rawUrl: "https://github.com/owner/repo",
          ref: "..",
          config: BASE_CONFIG,
        };
      // Driven by the mocked fetch response.
      case "not-found":
        return {
          rawUrl: "https://github.com/owner/repo",
          ref: undefined,
          config: BASE_CONFIG,
          fetch: () => fakeResponse(404),
        };
      case "private-no-token":
        // 403 with NO configured token ⇒ private-no-token.
        return {
          rawUrl: "https://github.com/owner/repo",
          ref: undefined,
          config: { ...BASE_CONFIG, githubToken: undefined },
          fetch: () => fakeResponse(403),
        };
      case "too-large":
        // Valid tarball body but a 1-byte cap ⇒ stream aborts as too-large.
        return {
          rawUrl: "https://github.com/owner/repo",
          ref: undefined,
          config: { ...BASE_CONFIG, maxRepoBytes: 1 },
          fetch: () => fakeResponse(200, tarballBytes),
        };
      case "too-many-files":
        // Valid tarball but a 0-file cap ⇒ extraction aborts as too-many-files.
        return {
          rawUrl: "https://github.com/owner/repo",
          ref: undefined,
          config: { ...BASE_CONFIG, maxFileCount: 0 },
          fetch: () => fakeResponse(200, tarballBytes),
        };
      case "timeout":
        // fetch rejects with an AbortError ⇒ timeout.
        return {
          rawUrl: "https://github.com/owner/repo",
          ref: undefined,
          config: BASE_CONFIG,
          fetch: () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            throw err;
          },
        };
      case "network-error":
        // fetch rejects with a generic transport error ⇒ network-error.
        return {
          rawUrl: "https://github.com/owner/repo",
          ref: undefined,
          config: BASE_CONFIG,
          fetch: () => {
            throw new Error("ECONNRESET");
          },
        };
    }
  }

  it("removes the per-scan scanDir after any ingestion failure", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...KINDS),
        // A nonce so each iteration uses a distinct scanDir name.
        fc.integer({ min: 0, max: 1_000_000 }),
        async (kind, nonce) => {
          const setup = setupFor(kind);

          // Create the per-scan directory and seed it with a dummy file so the
          // test proves partial contents are removed, not just an empty dir.
          const scanDir = path.join(workRoot, `scan-${kind}-${nonce}`);
          fs.mkdirSync(scanDir, { recursive: true });
          fs.writeFileSync(path.join(scanDir, "partial.txt"), "leftover");
          expect(fs.existsSync(scanDir)).toBe(true);

          // Install the fetch behavior for this kind (if any).
          if (setup.fetch) {
            fetchSpy = jest
              .spyOn(globalThis, "fetch")
              .mockImplementation((async () => setup.fetch!()) as never);
          } else {
            // No fetch expected; if it is reached, fail loudly via rejection.
            fetchSpy = jest
              .spyOn(globalThis, "fetch")
              .mockImplementation((async () => {
                throw new Error("unexpected fetch");
              }) as never);
          }

          const service = new GitHubIngestionService(setup.config);

          let thrown: unknown;
          try {
            await service.ingest(
              setup.rawUrl,
              setup.ref,
              `scan-${nonce}`,
              scanDir,
            );
          } catch (err) {
            thrown = err;
          }

          // Every failure surfaces as a discriminated GitHubIngestionError ...
          expect(thrown).toBeInstanceOf(GitHubIngestionError);
          // ... and the partially populated scanDir is gone afterward (Req 11.5).
          expect(fs.existsSync(scanDir)).toBe(false);

          fetchSpy.mockRestore();
          fetchSpy = undefined;
        },
      ),
      { numRuns: 120 },
    );
  }, 120000);
});
