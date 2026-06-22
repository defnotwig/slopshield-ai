import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as tar from "tar";
import { GitHubIngestionService } from "./github-ingestion.service.js";
import type { GitHubIngestionConfig } from "./github-ingestion.config.js";

/**
 * Example-based tests for GitHubIngestionService.safeExtract covering the
 * exclusion filter (excluded directories + binary files) and the guarantee
 * that extraction NEVER executes repository code (no-execution sentinel).
 *
 * Validates: Requirements 3.7, 3.8, 3.10, 4.3
 */
describe("GitHubIngestionService.safeExtract", () => {
  const baseConfig = (
    overrides: Partial<GitHubIngestionConfig> = {},
  ): GitHubIngestionConfig => ({
    maxRepoBytes: 100 * 1024 * 1024,
    maxFileCount: 5000,
    fetchTimeoutMs: 60_000,
    fetchMechanism: "tarball",
    ...overrides,
  });

  const service = new GitHubIngestionService(baseConfig());

  /** Temp directories created during a test, cleaned up in afterEach. */
  let tempDirs: string[] = [];

  const makeTempDir = (prefix: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };

  /**
   * Write the given entries (relative paths -> contents) into a staging dir and
   * build a real gzipped tarball stream from them. Entries are expected to be
   * prefixed with a top-level folder (e.g. "repo-main/") because safeExtract
   * uses `strip: 1` to drop the folder GitHub adds.
   */
  const buildTarball = (
    entries: Record<string, string>,
  ): NodeJS.ReadableStream => {
    const staging = makeTempDir("ingest-staging-");
    for (const [rel, content] of Object.entries(entries)) {
      const full = path.join(staging, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    // No `file` option and no callback => tar.create returns a readable stream.
    // `gzip: true` matches the createGunzip() step inside safeExtract.
    return tar.create(
      { gzip: true, cwd: staging },
      Object.keys(entries),
    ) as unknown as NodeJS.ReadableStream;
  };

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  describe("exclusion filter (Req 3.7, 3.8)", () => {
    it("excludes node_modules, .git, dist, and binary files while retaining source files", async () => {
      const tarStream = buildTarball({
        "repo-main/node_modules/x.js": "module.exports = 1;\n",
        "repo-main/.git/config": "[core]\n",
        "repo-main/dist/y.js": "console.log('built');\n",
        "repo-main/logo.png": "\x89PNG\r\n\x1a\n",
        "repo-main/app.ts": "export const app = true;\n",
      });

      const scanDir = makeTempDir("ingest-scan-");
      const result = await service.safeExtract(tarStream, scanDir);

      // Excluded paths must be absent from the scan directory.
      expect(fs.existsSync(path.join(scanDir, "node_modules"))).toBe(false);
      expect(fs.existsSync(path.join(scanDir, ".git"))).toBe(false);
      expect(fs.existsSync(path.join(scanDir, "dist"))).toBe(false);
      expect(fs.existsSync(path.join(scanDir, "logo.png"))).toBe(false);

      // The plain text source file is retained (strip:1 removed "repo-main/").
      expect(fs.existsSync(path.join(scanDir, "app.ts"))).toBe(true);
      expect(fs.readFileSync(path.join(scanDir, "app.ts"), "utf8")).toContain(
        "export const app",
      );

      // Only app.ts counts as a written file.
      expect(result.fileCount).toBe(1);
    });
  });

  describe("no-execution sentinel (Req 3.10, 4.3)", () => {
    it("never executes repository scripts during extraction", async () => {
      // A unique sentinel path that hostile scripts WOULD create if run.
      const sentinel = path.join(
        os.tmpdir(),
        `SENTINEL_${process.pid}_${Date.now()}`,
      );
      // Make sure it does not exist before extraction.
      if (fs.existsSync(sentinel)) fs.rmSync(sentinel, { force: true });

      const hostilePackageJson = JSON.stringify(
        {
          name: "hostile-repo",
          version: "1.0.0",
          scripts: {
            // If npm install / lifecycle scripts ran, this would write the sentinel.
            postinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(
              sentinel,
            )}, 'pwned')"`,
          },
        },
        null,
        2,
      );

      const evilScript = `#!/bin/sh\necho pwned > ${JSON.stringify(sentinel)}\n`;

      const tarStream = buildTarball({
        "repo-main/package.json": hostilePackageJson,
        "repo-main/evil.sh": evilScript,
        "repo-main/index.ts": "export const ok = true;\n",
      });

      const scanDir = makeTempDir("ingest-scan-");
      const result = await service.safeExtract(tarStream, scanDir);

      // The core guarantee: extraction writes files but NEVER runs them.
      expect(fs.existsSync(sentinel)).toBe(false);

      // package.json is a normal text file (not binary/excluded) => extracted.
      expect(fs.existsSync(path.join(scanDir, "package.json"))).toBe(true);
      // evil.sh is also just an inert file on disk; it is not executed.
      expect(fs.existsSync(path.join(scanDir, "evil.sh"))).toBe(true);
      expect(fs.existsSync(path.join(scanDir, "index.ts"))).toBe(true);

      // package.json, evil.sh, index.ts all written.
      expect(result.fileCount).toBe(3);

      // Defensive cleanup if some other process created it.
      if (fs.existsSync(sentinel)) fs.rmSync(sentinel, { force: true });
    });
  });
});
