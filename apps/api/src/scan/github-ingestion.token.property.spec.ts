// Feature: github-repository-scanner, Property 11
import "reflect-metadata";
import fc from "fast-check";
import { Logger } from "@nestjs/common";
import { Readable } from "node:stream";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as tar from "tar";
import {
  GitHubIngestionService,
  GitHubIngestionError,
} from "./github-ingestion.service";
import type { GitHubIngestionConfig } from "./github-ingestion.config";

/**
 * Property 11: Token non-leakage
 *
 * For any configured `GITHUB_TOKEN` value, after an ingestion run the token
 * string never appears in:
 *  - the `GitHubIngestionError` message / thrown error (message + stack),
 *  - any captured logger or console output, or
 *  - (where applicable) the persisted scan data on disk.
 *
 * The token is only ever placed into the outbound `Authorization: Bearer`
 * header inside `fetchTarball`; it must never escape into surfaced errors,
 * logs, or extracted files regardless of which fetch outcome (success, 404,
 * 403, or a network throw) the run hits.
 *
 * Validates: Requirements 9.4
 */

/** Logger methods we spy on to capture everything the service might emit. */
const LOGGER_METHODS = ["log", "error", "warn", "debug", "verbose"] as const;
/** Console methods we also capture, in case anything bypasses Nest's Logger. */
const CONSOLE_METHODS = ["log", "error", "warn", "debug", "info"] as const;

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

/** How the mocked global fetch behaves for a given iteration. */
type FetchOutcome = "success" | "not-found" | "forbidden" | "network-throw";

const FETCH_OUTCOMES: FetchOutcome[] = [
  "success",
  "not-found",
  "forbidden",
  "network-throw",
];

/**
 * Recursively collect the contents of every file under `dir` so we can prove
 * the token never landed in the persisted scan data after a successful run.
 */
function readAllFiles(dir: string): string {
  let combined = "";
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return combined;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      combined += readAllFiles(full);
    } else if (e.isFile()) {
      // Include the path itself plus the contents.
      combined += full + "\n";
      try {
        combined += fs.readFileSync(full, "utf8") + "\n";
      } catch {
        /* binary/unreadable — path alone is enough for the assertion */
      }
    }
  }
  return combined;
}

describe("GitHubIngestionService — Property 11: Token non-leakage", () => {
  let workRoot: string;
  /** A real, valid gzipped tarball (one small text file) reused per iteration. */
  let tarballBytes: Buffer;

  beforeAll(() => {
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ss-token-prop-"));

    // Build a well-formed GitHub-style tarball: a single top-level folder
    // (stripped by safeExtract) containing one non-excluded source file.
    const srcDir = path.join(workRoot, "src");
    const topDir = path.join(srcDir, "owner-repo-abc1234");
    fs.mkdirSync(topDir, { recursive: true });
    fs.writeFileSync(path.join(topDir, "index.ts"), "export const x = 1;\n");

    const tgzPath = path.join(workRoot, "repo.tgz");
    tar.c({ gzip: true, cwd: srcDir, file: tgzPath, sync: true }, [
      "owner-repo-abc1234/index.ts",
    ]);
    tarballBytes = fs.readFileSync(tgzPath);
  });

  afterAll(() => {
    fs.rmSync(workRoot, { recursive: true, force: true });
  });

  it("never leaks the configured GITHUB_TOKEN into errors, logs, or persisted data", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Tokens: a realistic `ghp_` PAT shape OR an arbitrary token-like string.
        // Real access tokens are non-whitespace credential strings; we exclude
        // whitespace and use a meaningful minimum length so the assertion tests
        // for an actual credential leak rather than trivially matching a single
        // space or punctuation char that any error/log text naturally contains.
        fc.oneof(
          fc.stringMatching(/^[A-Za-z0-9]{36}$/).map((s) => `ghp_${s}`),
          fc.stringMatching(/^[A-Za-z0-9_-]{8,60}$/),
        ),
        fc.constantFrom(...FETCH_OUTCOMES),
        fc.integer({ min: 0, max: 1_000_000 }),
        async (token, outcome, nonce) => {
          // Capture everything the service might emit during the run.
          const captured: string[] = [];
          const push = (...args: unknown[]) => {
            captured.push(args.map((a) => String(a)).join(" "));
          };

          const loggerSpies = LOGGER_METHODS.map((m) =>
            jest
              .spyOn(Logger.prototype, m as never)
              .mockImplementation(push as never),
          );
          const consoleSpies = CONSOLE_METHODS.map((m) =>
            jest.spyOn(console, m as never).mockImplementation(push as never),
          );

          // Drive the mocked global fetch to the requested outcome.
          const fetchSpy = jest
            .spyOn(globalThis, "fetch")
            .mockImplementation((async () => {
              switch (outcome) {
                case "success":
                  return fakeResponse(200, tarballBytes);
                case "not-found":
                  return fakeResponse(404);
                case "forbidden":
                  return fakeResponse(403);
                case "network-throw":
                  throw new Error("ECONNRESET while contacting host");
              }
            }) as never);

          const scanDir = path.join(workRoot, `scan-${nonce}`);
          // tar extraction requires the destination directory to exist.
          fs.mkdirSync(scanDir, { recursive: true });
          const service = new GitHubIngestionService({
            ...BASE_CONFIG,
            githubToken: token,
          });

          let thrown: unknown;
          try {
            await service.ingest(
              "https://github.com/owner/repo",
              undefined,
              `scan-${nonce}`,
              scanDir,
            );
          } catch (err) {
            thrown = err;
          }

          try {
            // Sanity: the configured token WAS actually used on the wire, so a
            // leak would be a real escape and not a no-op assertion. The
            // Authorization header must carry the bearer token.
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            const callArgs = fetchSpy.mock.calls[0] as unknown[];
            const init = callArgs[1] as { headers?: Record<string, string> };
            expect(init?.headers?.Authorization).toBe(`Bearer ${token}`);

            // The token must NOT appear in any captured log/console line.
            for (const line of captured) {
              expect(line).not.toContain(token);
            }

            // If an error was thrown, its message and stack must be clean.
            if (thrown !== undefined) {
              expect(thrown).toBeInstanceOf(GitHubIngestionError);
              const e = thrown as GitHubIngestionError;
              expect(e.message).not.toContain(token);
              expect(String(e.stack ?? "")).not.toContain(token);
            }

            // For a successful run, the persisted scan data must be token-free.
            if (outcome === "success") {
              expect(thrown).toBeUndefined();
              const persisted = readAllFiles(scanDir);
              expect(persisted).not.toContain(token);
            }
          } finally {
            for (const s of loggerSpies) s.mockRestore();
            for (const s of consoleSpies) s.mockRestore();
            fetchSpy.mockRestore();
            fs.rmSync(scanDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 120 },
    );
  }, 120_000);
});
