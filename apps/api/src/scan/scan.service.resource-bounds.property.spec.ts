// Feature: production-grade-system, Property 14: Resource bounds are enforced
import "reflect-metadata";
import fc from "fast-check";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  safeExtractArchive,
  ArchiveExtractionError,
  type ArchiveEntry,
  type SafeExtractLimits,
} from "./scan.service";

/**
 * Property 14: Resource bounds are enforced
 *
 * For any archive that exceeds the configured maximum file count or the
 * configured maximum cumulative byte size, `safeExtractArchive` aborts the
 * entire extraction with an `ArchiveExtractionError` (`too-many-files` /
 * `too-large`) and writes none of the over-limit content. For any archive that
 * stays within both bounds, extraction succeeds and reports the exact file
 * count and cumulative byte total written.
 *
 * Validates: Requirements 4.5, 4.6
 */

/** A safe, always-contained relative entry path segment. */
const safeSegmentArb = fc
  .stringMatching(/^[A-Za-z0-9._-]{1,12}$/)
  .filter((s) => s !== "." && s !== ".." && s.length > 0);

/** A safe, always-contained relative entry path (1..4 segments). */
const safeEntryArb = fc
  .array(safeSegmentArb, { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join("/"));

/** Recursively count the regular files actually written under `dir`. */
function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(full);
    else n += 1;
  }
  return n;
}

describe("safeExtractArchive — Property 14: resource bounds are enforced", () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-resource-bounds-"));
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("succeeds and reports exact counts when within both bounds", () => {
    fc.assert(
      fc.property(
        // Generate unique entry paths plus a per-entry byte size.
        // Uniqueness is case-insensitive so generated entry paths cannot
        // collide on case-insensitive filesystems (e.g. Windows/macOS), where
        // "A" and "a" map to the same file and would otherwise overwrite.
        fc.uniqueArray(fc.tuple(safeEntryArb, fc.integer({ min: 0, max: 256 })), {
          minLength: 1,
          maxLength: 12,
          selector: ([p]) => p.toLowerCase(),
        }).filter((pairs) => {
          // Ensure no entry path is a prefix of another (which would cause a
          // conflict between a file entry and an implicit parent directory).
          const paths = pairs.map(([p]) => p.toLowerCase());
          for (let i = 0; i < paths.length; i++) {
            for (let j = 0; j < paths.length; j++) {
              if (i === j) continue;
              if (paths[j].startsWith(paths[i] + "/")) return false;
            }
          }
          return true;
        }),
        (pairs) => {
          const runScan = fs.mkdtempSync(path.join(parentDir, "ok-"));
          const entries: ArchiveEntry[] = pairs.map(([p, size]) => ({
            path: p,
            type: "file",
            data: Buffer.alloc(size, 0x61),
          }));
          const expectedFiles = entries.length;
          const expectedBytes = entries.reduce(
            (acc, e) => acc + (e.data?.length ?? 0),
            0,
          );

          // Limits chosen to strictly contain this archive.
          const limits: SafeExtractLimits = {
            maxFileCount: expectedFiles,
            maxBytes: expectedBytes,
          };

          const result = safeExtractArchive(entries, runScan, limits);

          expect(result.fileCount).toBe(expectedFiles);
          expect(result.totalBytes).toBe(expectedBytes);
          // Exactly the expected number of files were materialized.
          expect(countFiles(runScan)).toBe(expectedFiles);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects archives that exceed maxFileCount", () => {
    fc.assert(
      fc.property(
        // A file budget and at least one extra file beyond it.
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 10 }),
        (maxFileCount, overBy) => {
          const runScan = fs.mkdtempSync(path.join(parentDir, "many-"));
          const total = maxFileCount + overBy;
          const entries: ArchiveEntry[] = Array.from(
            { length: total },
            (_, i) => ({
              path: `file-${i}.ts`,
              type: "file" as const,
              data: Buffer.from("x"),
            }),
          );

          const limits: SafeExtractLimits = {
            maxFileCount,
            // Generous byte budget so the file-count cap is what trips.
            maxBytes: total * 1024,
          };

          let thrown: unknown;
          try {
            safeExtractArchive(entries, runScan, limits);
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeInstanceOf(ArchiveExtractionError);
          expect((thrown as ArchiveExtractionError).kind).toBe(
            "too-many-files",
          );
          // Never wrote more files than the configured cap.
          expect(countFiles(runScan)).toBeLessThanOrEqual(maxFileCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects archives that exceed maxBytes", () => {
    fc.assert(
      fc.property(
        // Per-file size, file count, and a byte budget that is exceeded.
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 2, max: 12 }),
        (perFileSize, fileCount) => {
          const runScan = fs.mkdtempSync(path.join(parentDir, "big-"));
          const entries: ArchiveEntry[] = Array.from(
            { length: fileCount },
            (_, i) => ({
              path: `file-${i}.ts`,
              type: "file" as const,
              data: Buffer.alloc(perFileSize, 0x62),
            }),
          );
          const totalBytes = perFileSize * fileCount;

          // Budget below the cumulative total but above any single file, so the
          // byte cap trips partway through rather than on the first entry.
          const limits: SafeExtractLimits = {
            maxFileCount: fileCount,
            maxBytes: totalBytes - 1,
          };

          let thrown: unknown;
          try {
            safeExtractArchive(entries, runScan, limits);
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeInstanceOf(ArchiveExtractionError);
          expect((thrown as ArchiveExtractionError).kind).toBe("too-large");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("uses declared entry size for the byte cap even without data", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        (declaredSize) => {
          const runScan = fs.mkdtempSync(path.join(parentDir, "decl-"));
          const entries: ArchiveEntry[] = [
            { path: "a.ts", type: "file", size: declaredSize },
          ];

          // Budget one byte short of the declared size must reject.
          const limits: SafeExtractLimits = {
            maxFileCount: 1,
            maxBytes: declaredSize - 1,
          };

          expect(() => safeExtractArchive(entries, runScan, limits)).toThrow(
            ArchiveExtractionError,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
