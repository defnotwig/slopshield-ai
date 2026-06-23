// Feature: production-grade-system, Property 12: Extraction confines all paths within the scan directory
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
 * Property 12: Extraction confines all paths within the scan directory
 *
 * For any archive (GitHub tarball or uploaded ZIP) containing entries with
 * arbitrary paths (including `../` sequences, absolute paths, and symlinks),
 * every file actually written resolves to a path inside the Scan_Directory; if
 * any entry's resolved path escapes the Scan_Directory the entire scan fails
 * immediately and no escaping entry is written.
 *
 * Validates: Requirements 4.8
 */

const LIMITS: SafeExtractLimits = {
  maxFileCount: 10_000,
  maxBytes: 100 * 1024 * 1024,
};

/** Recursively collect every file path under `dir` (returns [] if missing). */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** True iff `child` resolves to `root` or a path strictly beneath it. */
function isContained(root: string, child: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(child);
  return c === r || c.startsWith(r + path.sep);
}

/** A safe, contained path segment. */
const safeSegmentArb = fc
  .stringMatching(/^[A-Za-z0-9._-]{1,12}$/)
  .filter((s) => s !== "." && s !== ".." && s.length > 0);

/** A safe, always-contained relative entry path (1..5 segments). */
const safeEntryArb = fc
  .array(safeSegmentArb, { minLength: 1, maxLength: 5 })
  .map((parts) => parts.join("/"));

/** An adversarial entry path that escapes the scan dir (`../`, absolute, mixed sep). */
const escapingEntryArb = fc.oneof(
  // relative traversal escapes
  fc
    .integer({ min: 1, max: 8 })
    .map((n) => `${"../".repeat(n)}escape.txt`),
  fc
    .tuple(safeSegmentArb, fc.integer({ min: 2, max: 8 }))
    .map(([s, n]) => `${s}/${"../".repeat(n)}escape.txt`),
  // absolute POSIX path
  fc.constant("/tmp/ss-escape-PWNED.txt"),
  fc.constant("/etc/ss-escape-PWNED.txt"),
  // windows-style backslash traversal
  fc.integer({ min: 2, max: 6 }).map((n) => `${"..\\".repeat(n)}escape-win.txt`),
);

describe("safeExtractArchive — Property 12: extraction path confinement", () => {
  let parentDir: string;
  let scanDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-extract-conf-"));
    scanDir = path.join(parentDir, "scan");
    fs.mkdirSync(scanDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("writes only contained files for archives of safe entries", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(safeEntryArb, { minLength: 1, maxLength: 8 }).filter(
          (paths) => {
            // Ensure no path is a prefix of another (avoids file/directory
            // conflicts where one entry creates a dir that another entry tries
            // to overwrite as a file).
            for (let i = 0; i < paths.length; i++) {
              for (let j = 0; j < paths.length; j++) {
                if (i !== j && paths[j].startsWith(paths[i] + "/")) {
                  return false;
                }
              }
            }
            return true;
          },
        ),
        (paths) => {
          // Fresh scan dir per run so file counts are deterministic.
          const runScan = fs.mkdtempSync(path.join(parentDir, "ok-"));
          const entries: ArchiveEntry[] = paths.map((p, i) => ({
            path: p,
            type: "file",
            data: Buffer.from(`content-${i}`),
          }));

          const result = safeExtractArchive(entries, runScan, LIMITS);

          // Every written file is contained within the scan dir.
          for (const file of walk(runScan)) {
            expect(isContained(runScan, file)).toBe(true);
          }
          expect(result.fileCount).toBe(entries.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("fails the entire scan and writes nothing outside scanDir when any entry escapes", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(safeEntryArb, { minLength: 0, maxLength: 5 }),
        escapingEntryArb,
        fc.integer({ min: 0, max: 5 }),
        (safePaths, escaper, insertAt) => {
          const runScan = fs.mkdtempSync(path.join(parentDir, "esc-"));

          const safeEntries: ArchiveEntry[] = safePaths.map((p, i) => ({
            path: p,
            type: "file" as const,
            data: Buffer.from(`safe-${i}`),
          }));
          const escapeEntry: ArchiveEntry = {
            path: escaper,
            type: "file",
            data: Buffer.from("PWNED"),
          };

          // Insert the escaping entry at an arbitrary position.
          const at = Math.min(insertAt, safeEntries.length);
          const entries = [
            ...safeEntries.slice(0, at),
            escapeEntry,
            ...safeEntries.slice(at),
          ];

          // The escape must fail the entire extraction.
          expect(() => safeExtractArchive(entries, runScan, LIMITS)).toThrow(
            ArchiveExtractionError,
          );

          // The escaping entry was never written outside the scan dir.
          expect(fs.existsSync(path.join(parentDir, "escape.txt"))).toBe(false);
          expect(
            fs.existsSync(path.resolve(parentDir, "..", "escape.txt")),
          ).toBe(false);
          expect(fs.existsSync("/tmp/ss-escape-PWNED.txt")).toBe(false);
          expect(fs.existsSync("/etc/ss-escape-PWNED.txt")).toBe(false);

          // Whatever did get written stays within the scan dir.
          for (const file of walk(runScan)) {
            expect(isContained(runScan, file)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects symlink and hard-link entries as escape vectors", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"symlink" | "link">("symlink", "link"),
        fc.string(),
        (linkType, target) => {
          const runScan = fs.mkdtempSync(path.join(parentDir, "link-"));
          const entries: ArchiveEntry[] = [
            { path: "ok.ts", type: "file", data: Buffer.from("ok") },
            {
              path: "link-out",
              type: linkType,
              linkname: target || "../../../../etc/passwd",
            },
          ];

          expect(() => safeExtractArchive(entries, runScan, LIMITS)).toThrow(
            ArchiveExtractionError,
          );

          // No symlink was materialized inside the scan dir.
          for (const file of walk(runScan)) {
            expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
