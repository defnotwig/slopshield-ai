// Feature: production-grade-system, Property 14: Resource bounds are enforced
import "reflect-metadata";
import fc from "fast-check";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  GitHubIngestionService,
  GitHubIngestionError,
} from "./github-ingestion.service";
import type { GitHubIngestionConfig } from "./github-ingestion.config";

/**
 * Property 14: Resource bounds are enforced
 *
 * For any fetched repository or archive that exceeds the maximum repository
 * size (MAX_REPO_BYTES) or the maximum file count (MAX_FILE_COUNT), the
 * GitHub_Ingestion_Service aborts the operation and surfaces a descriptive
 * `GitHubIngestionError` ("too-large" / "too-many-files"); archives within
 * the configured bounds are accepted and extracted.
 *
 * The ScanService wraps these ingestion failures into a failed ScanJob with
 * the error message recorded as `failureReason` (see
 * `prepareAndEnqueue`/`toHttpException`), so enforcing the bound at the
 * ingestion layer is what drives the "mark failed + record reason" behavior.
 *
 * This test exercises the two enforceable resource bounds directly:
 *   - max-file-count via `safeExtract` (counts extracted File entries), and
 *   - max-bytes via the streaming cap inside `fetchTarball` (driven through
 *     `ingest` with a mocked global fetch).
 *
 * Validates: Requirements 4.5, 4.6
 */

const BASE_CONFIG: GitHubIngestionConfig = {
  maxRepoBytes: 100 * 1024 * 1024,
  maxFileCount: 5000,
  fetchTimeoutMs: 5000,
  fetchMechanism: "tarball",
};

// ---------------------------------------------------------------------------
// In-memory USTAR tar builder (lets us craft an exact number of file entries
// nested under the top-level "<owner>-<repo>-<sha>/" folder GitHub adds, which
// `safeExtract` strips with `strip: 1`).
// ---------------------------------------------------------------------------

const TYPE_FILE = "0";
const TOP = "owner-repo-deadbeef";

function octalField(value: number, len: number): Buffer {
  const str = value
    .toString(8)
    .padStart(len - 1, "0")
    .slice(-(len - 1));
  return Buffer.from(str + "\0", "ascii");
}

function buildTarEntry(name: string, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512, 0);
  header.write(name.slice(0, 100), 0, "ascii");
  octalField(0o644, 8).copy(header, 100);
  octalField(0, 8).copy(header, 108);
  octalField(0, 8).copy(header, 116);
  octalField(body.length, 12).copy(header, 124);
  octalField(0, 12).copy(header, 136);
  header.write(TYPE_FILE, 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  const chk = sum.toString(8).padStart(6, "0").slice(-6);
  header.write(chk + "\0 ", 148, "ascii");
  const pad = (512 - (body.length % 512)) % 512;
  return Buffer.concat([header, body, Buffer.alloc(pad, 0)]);
}

/** Build a gzipped tar of `fileCount` safe `.ts` files under the top folder. */
function buildTarWithFiles(fileCount: number, content = "x"): Buffer {
  const blocks: Buffer[] = [];
  for (let i = 0; i < fileCount; i++) {
    blocks.push(buildTarEntry(`${TOP}/file-${i}.ts`, content));
  }
  const trailer = Buffer.alloc(1024, 0);
  return gzipSync(Buffer.concat([...blocks, trailer]));
}

/** Web ReadableStream from a Buffer, mirroring `Response.body`. */
function webStreamFromBuffer(buf: Buffer): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    Readable.from([buf]),
  ) as unknown as ReadableStream<Uint8Array>;
}

function fakeResponse(status: number, body?: Buffer): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: body ? webStreamFromBuffer(body) : null,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// (A) max-file-count enforcement via safeExtract
// ---------------------------------------------------------------------------

describe("GitHubIngestionService.safeExtract — Property 14: max-file-count bound", () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-rbound-fc-"));
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("accepts archives within the file-count bound and rejects those exceeding it", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }), // maxFileCount
        fc.integer({ min: 1, max: 16 }), // actual file count
        fc.integer({ min: 0, max: 1_000_000 }), // unique scan dir nonce
        async (maxFileCount, fileCount, nonce) => {
          const scanDir = path.join(parentDir, `scan-fc-${nonce}`);
          fs.mkdirSync(scanDir, { recursive: true });

          const service = new GitHubIngestionService({
            ...BASE_CONFIG,
            maxFileCount,
          });
          const archive = buildTarWithFiles(fileCount);

          const withinBound = fileCount <= maxFileCount;
          try {
            if (withinBound) {
              const result = await service.safeExtract(
                Readable.from(archive),
                scanDir,
              );
              // Within bounds: extraction succeeds and reports the real count.
              expect(result.fileCount).toBe(fileCount);
            } else {
              // Exceeds bounds: must abort with a descriptive too-many-files error.
              let thrown: unknown;
              try {
                await service.safeExtract(Readable.from(archive), scanDir);
              } catch (err) {
                thrown = err;
              }
              expect(thrown).toBeInstanceOf(GitHubIngestionError);
              expect((thrown as GitHubIngestionError).kind).toBe(
                "too-many-files",
              );
              expect((thrown as GitHubIngestionError).message).toMatch(
                /file count/i,
              );
            }
          } finally {
            fs.rmSync(scanDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// (B) max-bytes enforcement via the streaming cap in fetchTarball (through ingest)
// ---------------------------------------------------------------------------

describe("GitHubIngestionService — Property 14: max-repo-bytes bound", () => {
  let parentDir: string;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-rbound-bytes-"));
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("aborts fetches exceeding MAX_REPO_BYTES and accepts those within it", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 64 }), // file content size (drives tarball size)
        fc.boolean(), // whether the bound should be exceeded
        fc.integer({ min: 0, max: 1_000_000 }), // unique scan dir nonce
        async (contentSize, shouldExceed, nonce) => {
          // A valid single-file gzipped tarball; its byte length is the amount
          // streamed through the cap in fetchTarball.
          const archive = buildTarWithFiles(1, "y".repeat(contentSize));
          const archiveBytes = archive.length;

          // Pick the cap relative to the real archive size so the expected
          // outcome is unambiguous.
          const maxRepoBytes = shouldExceed
            ? Math.max(1, archiveBytes - 1)
            : archiveBytes + 1024;

          const scanDir = path.join(parentDir, `scan-bytes-${nonce}`);
          fs.mkdirSync(scanDir, { recursive: true });

          fetchSpy = jest
            .spyOn(globalThis, "fetch")
            .mockImplementation(
              (async () => fakeResponse(200, archive)) as never,
            );

          const service = new GitHubIngestionService({
            ...BASE_CONFIG,
            maxRepoBytes,
          });

          let thrown: unknown;
          let result: unknown;
          try {
            result = await service.ingest(
              "https://github.com/owner/repo",
              undefined,
              `scan-bytes-${nonce}`,
              scanDir,
            );
          } catch (err) {
            thrown = err;
          } finally {
            fetchSpy.mockRestore();
            fs.rmSync(scanDir, { recursive: true, force: true });
          }

          if (shouldExceed) {
            // Over the size bound: aborts with a descriptive too-large error.
            expect(thrown).toBeInstanceOf(GitHubIngestionError);
            expect((thrown as GitHubIngestionError).kind).toBe("too-large");
            expect((thrown as GitHubIngestionError).message).toMatch(
              /size/i,
            );
          } else {
            // Within the size bound: ingestion succeeds.
            expect(thrown).toBeUndefined();
            expect((result as { fileCount: number }).fileCount).toBe(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
