// Feature: github-repository-scanner, Property 3
import "reflect-metadata";
import fc from "fast-check";
import { Readable } from "node:stream";
import {
  GitHubIngestionService,
  GitHubIngestionError,
  type ParsedRepo,
} from "./github-ingestion.service";

/**
 * Property 3: Size-cap safety
 *
 * For any incoming byte stream, if the cumulative number of bytes exceeds
 * `maxRepoBytes`, `fetchTarball`'s returned stream errors with a
 * GitHubIngestionError of kind "too-large" and forwards no more than
 * ~`maxRepoBytes` bytes downstream; streams at or below the cap pass through
 * fully and without error.
 *
 * Validates: Requirements 3.1, 3.2
 */

const PARSED: ParsedRepo = { owner: "octocat", repo: "hello-world" };

/**
 * Build a web ReadableStream from a list of Node Buffer chunks, mirroring the
 * shape of `Response.body` that `fetchTarball` wraps via `Readable.fromWeb`.
 */
function webStreamFromChunks(chunks: Buffer[]): ReadableStream<Uint8Array> {
  // Readable.toWeb produces a standards-compliant ReadableStream the service
  // can consume exactly as it would a real fetch() Response body.
  return Readable.toWeb(
    Readable.from(chunks),
  ) as unknown as ReadableStream<Uint8Array>;
}

/** Minimal Response-like object the service treats as a successful fetch. */
function fakeResponse(chunks: Buffer[]): Response {
  return {
    ok: true,
    status: 200,
    body: webStreamFromChunks(chunks),
  } as unknown as Response;
}

/**
 * Consume the Node stream returned by `fetchTarball`, capturing the total
 * number of bytes forwarded downstream and any error emitted by the stream.
 */
function consume(
  stream: NodeJS.ReadableStream,
): Promise<{ bytesForwarded: number; error?: unknown }> {
  return new Promise((resolve) => {
    let bytesForwarded = 0;
    stream.on("data", (chunk: Buffer) => {
      bytesForwarded += chunk.length;
    });
    stream.on("error", (error) => {
      resolve({ bytesForwarded, error });
    });
    stream.on("end", () => {
      resolve({ bytesForwarded });
    });
  });
}

describe("GitHubIngestionService.fetchTarball — Property 3: Size-cap safety", () => {
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
  });

  it("aborts with too-large iff total bytes exceed the cap; bytes forwarded ≤ cap", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A small cap so generated streams can land both above and below it.
        fc.integer({ min: 1, max: 512 }),
        // Random chunk sizes; their sum is the total stream size.
        fc.array(fc.integer({ min: 0, max: 200 }), {
          minLength: 0,
          maxLength: 12,
        }),
        async (cap, chunkSizes) => {
          const chunks = chunkSizes.map((n) => Buffer.alloc(n, 0x61));
          const total = chunks.reduce((sum, c) => sum + c.length, 0);

          fetchSpy = jest
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(fakeResponse(chunks));

          const service = new GitHubIngestionService({
            maxRepoBytes: cap,
            maxFileCount: 10,
            fetchTimeoutMs: 5000,
            fetchMechanism: "tarball",
          });

          const stream = await service.fetchTarball(PARSED, "scan-id");
          const { bytesForwarded, error } = await consume(stream);

          if (total > cap) {
            // Over the cap ⇒ the stream must error with a too-large error.
            expect(error).toBeInstanceOf(GitHubIngestionError);
            expect((error as GitHubIngestionError).kind).toBe("too-large");
            // The over-limit chunk is rejected (not pushed), so the bytes that
            // actually reached downstream never exceed the cap.
            expect(bytesForwarded).toBeLessThanOrEqual(cap);
          } else {
            // At/below the cap ⇒ no error and every byte passes through.
            expect(error).toBeUndefined();
            expect(bytesForwarded).toBe(total);
          }

          fetchSpy.mockRestore();
        },
      ),
      { numRuns: 150 },
    );
  });

  it("passes through fully when the whole stream is at or below the cap", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1024 }), async (total) => {
        const chunks = [Buffer.alloc(total, 0x62)];
        fetchSpy = jest
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(fakeResponse(chunks));

        const service = new GitHubIngestionService({
          maxRepoBytes: total, // cap exactly at the total — must pass
          maxFileCount: 10,
          fetchTimeoutMs: 5000,
          fetchMechanism: "tarball",
        });

        const stream = await service.fetchTarball(PARSED, "scan-id");
        const { bytesForwarded, error } = await consume(stream);

        expect(error).toBeUndefined();
        expect(bytesForwarded).toBe(total);

        fetchSpy.mockRestore();
      }),
      { numRuns: 150 },
    );
  });
});
