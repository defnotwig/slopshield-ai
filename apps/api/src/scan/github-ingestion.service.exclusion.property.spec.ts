// Feature: github-repository-scanner, Property 5
import "reflect-metadata";
import fc from "fast-check";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as tar from "tar";
import { GitHubIngestionService } from "./github-ingestion.service";

/**
 * Property 5: Exclusion-filter correctness
 *
 * For any set of archive entry paths, the extracted file set contains no entry
 * that lies under an excluded directory (node_modules, .git, dist, build, out,
 * .next, .turbo, coverage, .cache, vendor, __pycache__, .venv) and no entry
 * whose extension is in the binary-extension set; all other text entries are
 * retained.
 *
 * This is exercised end-to-end with a real gzipped tarball produced by the
 * `tar` package and extracted through `safeExtract` (which gunzips, untars with
 * strip:1, and applies the exclusion filter). GitHub adds a single top-level
 * folder to its tarballs, so every entry is prefixed with `repo-main/` and that
 * prefix is stripped during extraction.
 *
 * Validates: Requirements 3.7, 3.8, 4.3
 */

const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
  "vendor",
  "__pycache__",
  ".venv",
];

const BINARY_EXT = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".jar",
  ".wasm",
  ".mp4",
  ".mp3",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".bin",
];

const TEXT_EXT = [".ts", ".js", ".tsx", ".jsx", ".json", ".md", ".txt", ".py"];

/** A safe path segment for nesting (no separators, no excluded names). */
const safeSegment = fc
  .stringMatching(/^[a-z][a-z0-9]{0,7}$/)
  .filter((s) => !EXCLUDED_DIRS.includes(s));

/** Base file name without extension. */
const baseName = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);

/** A plain text source entry that MUST be retained. */
const textEntry = fc
  .record({
    dirs: fc.array(safeSegment, { minLength: 0, maxLength: 2 }),
    base: baseName,
    ext: fc.constantFrom(...TEXT_EXT),
  })
  .map(({ dirs, base, ext }) => ({
    relPath: [...dirs, `${base}${ext}`].join("/"),
    kind: "text" as const,
  }));

/** An entry under an excluded directory that MUST be dropped. */
const excludedDirEntry = fc
  .record({
    pre: fc.array(safeSegment, { minLength: 0, maxLength: 1 }),
    excluded: fc.constantFrom(...EXCLUDED_DIRS),
    post: fc.array(safeSegment, { minLength: 0, maxLength: 1 }),
    base: baseName,
    ext: fc.constantFrom(...TEXT_EXT),
  })
  .map(({ pre, excluded, post, base, ext }) => ({
    relPath: [...pre, excluded, ...post, `${base}${ext}`].join("/"),
    kind: "excluded" as const,
  }));

/** An entry with a binary extension that MUST be dropped. */
const binaryEntry = fc
  .record({
    dirs: fc.array(safeSegment, { minLength: 0, maxLength: 2 }),
    base: baseName,
    ext: fc.constantFrom(...BINARY_EXT),
  })
  .map(({ dirs, base, ext }) => ({
    relPath: [...dirs, `${base}${ext}`].join("/"),
    kind: "binary" as const,
  }));

const anyEntry = fc.oneof(textEntry, excludedDirEntry, binaryEntry);

/** Recursively list files (relative paths, posix separators) under a dir. */
async function walk(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await walk(path.join(dir, e.name), rel)));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function isUnderExcludedDir(relPath: string): boolean {
  return relPath.split("/").some((seg) => EXCLUDED_DIRS.includes(seg));
}

function hasBinaryExt(relPath: string): boolean {
  return BINARY_EXT.includes(path.extname(relPath).toLowerCase());
}

describe("GitHubIngestionService.safeExtract — Property 5: Exclusion-filter correctness", () => {
  const service = new GitHubIngestionService({
    maxRepoBytes: 100 * 1024 * 1024,
    maxFileCount: 100000,
    fetchTimeoutMs: 5000,
    fetchMechanism: "tarball",
  });

  it("drops excluded-dir and binary entries while retaining all text entries", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(anyEntry, { minLength: 1, maxLength: 8 }),
        async (entries) => {
          // De-duplicate relative paths so we never write the same file twice.
          const seen = new Set<string>();
          const unique = entries.filter((e) => {
            if (seen.has(e.relPath)) return false;
            seen.add(e.relPath);
            return true;
          });

          const work = await fs.mkdtemp(
            path.join(os.tmpdir(), "gh-excl-prop-"),
          );
          const topDir = "repo-main";
          const srcRoot = path.join(work, "src");
          const topRoot = path.join(srcRoot, topDir);
          const scanDir = path.join(work, "scan");
          const tarPath = path.join(work, "repo.tar.gz");

          try {
            await fs.mkdir(scanDir, { recursive: true });

            // Materialize every generated entry under the top-level folder so
            // the produced archive mirrors a GitHub tarball (repo-main/...).
            for (const e of unique) {
              const abs = path.join(topRoot, e.relPath);
              await fs.mkdir(path.dirname(abs), { recursive: true });
              await fs.writeFile(abs, `content of ${e.relPath}\n`);
            }

            // Create the gzipped tarball with cwd = parent of the top folder so
            // entries are stored as "repo-main/<relPath>".
            await tar.c({ gzip: true, cwd: srcRoot, file: tarPath }, [topDir]);

            await service.safeExtract(createReadStream(tarPath), scanDir);

            const extracted = await walk(scanDir);
            const extractedSet = new Set(extracted);

            // No extracted file lies under an excluded directory.
            for (const rel of extracted) {
              expect(isUnderExcludedDir(rel)).toBe(false);
              // No extracted file has a binary extension.
              expect(hasBinaryExt(rel)).toBe(false);
            }

            // Every generated plain text entry (not excluded, not binary) is
            // present after extraction (top folder stripped).
            for (const e of unique) {
              if (e.kind === "text") {
                expect(extractedSet.has(e.relPath)).toBe(true);
              } else {
                expect(extractedSet.has(e.relPath)).toBe(false);
              }
            }
          } finally {
            await fs.rm(work, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
