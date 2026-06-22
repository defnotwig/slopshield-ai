// Feature: github-repository-scanner, Property 4
import "reflect-metadata";
import fc from "fast-check";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as tar from "tar";
import {
  GitHubIngestionService,
  GitHubIngestionError,
} from "./github-ingestion.service";

/**
 * Property 4: File-count-cap safety
 *
 * For any archive whose number of included (post-exclusion) file entries
 * exceeds `maxFileCount`, `safeExtract` aborts with a GitHubIngestionError of
 * kind "too-many-files"; archives with a count at or below the cap extract
 * successfully and report `fileCount === N`.
 *
 * Validates: Requirements 3.3, 3.4
 */

/**
 * Build a real gzipped tarball on disk containing `n` small non-excluded text
 * files (`file0.ts` .. file{n-1}.ts) nested under a single GitHub-style
 * top-level folder (`repo-main/`). GitHub tarballs always wrap content in such
 * a folder, and `safeExtract` uses `strip: 1`, so the files land directly in
 * the scan directory after extraction.
 *
 * Returns the path to the created `.tgz` file. The caller owns cleanup.
 */
function buildTarball(tmpRoot: string, n: number): string {
  const topDir = "repo-main";
  const sourceDir = path.join(tmpRoot, "src");
  const filesDir = path.join(sourceDir, topDir);
  fs.mkdirSync(filesDir, { recursive: true });

  const entryPaths: string[] = [];
  for (let i = 0; i < n; i++) {
    const rel = `${topDir}/file${i}.ts`;
    fs.writeFileSync(
      path.join(sourceDir, rel),
      `export const value${i} = ${i};\n`,
    );
    entryPaths.push(rel);
  }

  const tgzPath = path.join(tmpRoot, "repo.tgz");
  // Synchronous create so the file is fully written before we read it.
  tar.c(
    { gzip: true, cwd: sourceDir, file: tgzPath, sync: true },
    // When n === 0 we still need a valid (empty) archive: pass the top dir so
    // the tarball is well-formed but yields no included files after strip.
    entryPaths.length > 0 ? entryPaths : [`${topDir}/`],
  );

  return tgzPath;
}

/**
 * Settle a promise within `ms`, reporting whether it resolved, rejected, or
 * never settled. Lets the property report a clean counterexample instead of a
 * raw Jest timeout when `safeExtract` fails to settle on overflow.
 */
async function settleWithin<T>(
  p: Promise<T>,
  ms: number,
): Promise<
  | { status: "resolved"; value: T }
  | { status: "rejected"; error: unknown }
  | { status: "hung" }
> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<{ status: "hung" }>((resolve) => {
    timer = setTimeout(() => resolve({ status: "hung" }), ms);
  });
  const settled = p
    .then((value) => ({ status: "resolved" as const, value }))
    .catch((error) => ({ status: "rejected" as const, error }));
  const result = await Promise.race([settled, timeout]);
  clearTimeout(timer!);
  return result;
}

describe("GitHubIngestionService.safeExtract — Property 4: File-count-cap safety", () => {
  let workRoot: string;

  beforeAll(() => {
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ss-filecount-"));
  });

  afterAll(() => {
    fs.rmSync(workRoot, { recursive: true, force: true });
  });

  it("aborts with too-many-files iff included file count exceeds the cap", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Small cap so generated archives can land both above and below it.
        fc.integer({ min: 1, max: 8 }),
        // File count, deliberately spanning below, at, and above the cap.
        fc.integer({ min: 0, max: 12 }),
        async (cap, n) => {
          const caseDir = fs.mkdtempSync(path.join(workRoot, "case-"));
          const scanDir = path.join(caseDir, "scan");
          fs.mkdirSync(scanDir, { recursive: true });

          const tgzPath = buildTarball(caseDir, n);

          const service = new GitHubIngestionService({
            maxRepoBytes: 100 * 1024 * 1024, // generous — not under test here
            maxFileCount: cap,
            fetchTimeoutMs: 5000,
            fetchMechanism: "tarball",
          });

          try {
            const tarStream = fs.createReadStream(tgzPath);
            const outcome = await settleWithin(
              service.safeExtract(tarStream, scanDir),
              4000,
            );

            if (n > cap) {
              // Over the cap ⇒ extraction must abort by rejecting with a
              // GitHubIngestionError of kind "too-many-files".
              expect(outcome.status).toBe("rejected");
              const error = (outcome as { error: unknown }).error;
              expect(error).toBeInstanceOf(GitHubIngestionError);
              expect((error as GitHubIngestionError).kind).toBe(
                "too-many-files",
              );
            } else {
              // At/below the cap ⇒ success with exactly N extracted files.
              expect(outcome.status).toBe("resolved");
              const value = (outcome as { value: { fileCount: number } }).value;
              expect(value.fileCount).toBe(n);
            }
          } finally {
            fs.rmSync(caseDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);
});
