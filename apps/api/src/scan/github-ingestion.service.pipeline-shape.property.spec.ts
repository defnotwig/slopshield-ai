// Feature: github-repository-scanner, Property 7
import "reflect-metadata";
import fc from "fast-check";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as tar from "tar";
import { FileClassifier } from "@slopshield/scanner-plugins";
import { GitHubIngestionService } from "./github-ingestion.service";

/**
 * Property 7: Pipeline-shape compatibility
 *
 * For any successfully extracted repository, every produced path in `scanDir`
 * is relative (never absolute), has GitHub's top-level
 * `{owner}-{repo}-{sha}/` folder stripped, and is consumable by
 * `FileClassifier` without error — matching the `{ scanDir, files, scanId }`
 * `AnalysisContext` shape the existing `ScanProcessor` already expects.
 *
 * This is exercised end-to-end with a real gzipped tarball produced by the
 * `tar` package whose entries all live under a single GitHub-style top-level
 * folder (e.g. `owner-repo-abc123/...`). `safeExtract` gunzips, untars with
 * `strip: 1`, and applies the exclusion/path-traversal filters. We then mirror
 * exactly what `ScanProcessor` does: recursively glob the scan directory into
 * relative paths and feed them to `FileClassifier.classifyFiles`.
 *
 * Validates: Requirements 4.4, 5.3
 */

/** Source file extensions the classifier understands. */
const SOURCE_EXT = [".ts", ".tsx", ".js", ".jsx", ".py", ".json", ".md"];

/** A safe path segment: lowercase, no separators, not an excluded dir. */
const safeSegment = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);

/** A base file name without extension. */
const baseName = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);

/** A nested source file entry under the GitHub top-level folder. */
const sourceEntry = fc
  .record({
    dirs: fc.array(safeSegment, { minLength: 0, maxLength: 3 }),
    base: baseName,
    ext: fc.constantFrom(...SOURCE_EXT),
  })
  .map(({ dirs, base, ext }) => [...dirs, `${base}${ext}`].join("/"));

/**
 * Recursively list files under `dir`, returning paths RELATIVE to `dir` using
 * the platform separator — mirroring `ScanProcessor.globFilesSync`, which uses
 * `path.relative(baseDir, filePath)`.
 */
async function globFiles(dir: string, baseDir = dir): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await globFiles(full, baseDir)));
    } else if (e.isFile()) {
      out.push(path.relative(baseDir, full));
    }
  }
  return out;
}

describe("GitHubIngestionService.safeExtract — Property 7: Pipeline-shape compatibility", () => {
  const service = new GitHubIngestionService({
    maxRepoBytes: 100 * 1024 * 1024,
    maxFileCount: 100000,
    fetchTimeoutMs: 5000,
    fetchMechanism: "tarball",
  });
  const classifier = new FileClassifier();

  it("produces relative, top-folder-stripped paths consumable by FileClassifier", async () => {
    await fc.assert(
      fc.asyncProperty(
        // The GitHub-style top-level folder name: owner-repo-<sha>.
        fc.stringMatching(
          /^[a-z][a-z0-9]{0,7}-[a-z][a-z0-9]{0,7}-[a-f0-9]{7}$/,
        ),
        // A small set of nested source files (kept small for ≥100 iterations).
        fc.array(sourceEntry, { minLength: 1, maxLength: 6 }),
        async (topDir, rawEntries) => {
          // De-duplicate relative paths so we never write the same file twice.
          const seen = new Set<string>();
          const entries = rawEntries.filter((rel) => {
            if (seen.has(rel)) return false;
            seen.add(rel);
            return true;
          });

          const work = await fs.mkdtemp(
            path.join(os.tmpdir(), "gh-pipeline-prop-"),
          );
          const srcRoot = path.join(work, "src");
          const topRoot = path.join(srcRoot, topDir);
          const scanDir = path.join(work, "scan");
          const tarPath = path.join(work, "repo.tar.gz");

          try {
            await fs.mkdir(scanDir, { recursive: true });

            // Materialize every entry under the single top-level folder so the
            // produced archive mirrors a GitHub tarball: `owner-repo-sha/...`.
            for (const rel of entries) {
              const abs = path.join(topRoot, rel);
              await fs.mkdir(path.dirname(abs), { recursive: true });
              await fs.writeFile(abs, `// content of ${rel}\n`);
            }

            // cwd = parent of the top folder so entries are stored as
            // "owner-repo-sha/<rel>".
            await tar.c({ gzip: true, cwd: srcRoot, file: tarPath }, [topDir]);

            const result = await service.safeExtract(
              createReadStream(tarPath),
              scanDir,
            );

            // safeExtract reports the number of files it wrote.
            expect(result.fileCount).toBe(entries.length);

            // Mirror ScanProcessor: glob relative paths from the scan dir.
            const files = await globFiles(scanDir);

            // The full set of produced files matches the generated entries
            // exactly (top folder stripped, nothing extra, nothing lost).
            const normalized = files
              .map((f) => f.split(path.sep).join("/"))
              .sort();
            expect(normalized).toEqual([...entries].sort());

            for (const rel of files) {
              // Every produced path is RELATIVE (never absolute).
              expect(path.isAbsolute(rel)).toBe(false);

              // The top-level "{owner}-{repo}-{sha}/" folder has been stripped:
              // no produced path begins with that folder name.
              const firstSeg = rel.split(path.sep)[0];
              expect(firstSeg).not.toBe(topDir);
            }

            // FileClassifier consumes the relative paths without throwing and
            // returns exactly one classification entry per input file — the
            // { scanDir, files, scanId } AnalysisContext shape ScanProcessor
            // builds (globFiles -> classifyFiles).
            const classified = classifier.classifyFiles(files);
            expect(classified).toHaveLength(files.length);
            for (let i = 0; i < files.length; i++) {
              expect(classified[i].path).toBe(files[i]);
              expect(typeof classified[i].language).toBe("string");
              expect(typeof classified[i].fileType).toBe("string");
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
