import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as tar from "tar";
import { GitHubIngestionService } from "./github-ingestion.service.js";
import type { GitHubIngestionConfig } from "./github-ingestion.config.js";
import { FileClassifier } from "@slopshield/scanner-plugins";
import type { AnalysisContext } from "@slopshield/scanner-plugins";
import { ScannerOrchestrator } from "../scanner/scanner.orchestrator.js";
import { StandardsMapper } from "../rules/standards-mapper.js";

/**
 * Fixture-tarball end-to-end integration test (NO network).
 *
 * Builds a real gzipped tarball fixture on disk (a couple of source files that
 * trigger findings, a node_modules dependency, and a binary file), then drives
 * the same flow the ScanProcessor uses:
 *
 *   safeExtract (from a file stream, NOT fetch)
 *     -> globFilesSync
 *     -> FileClassifier.classifyFiles
 *     -> ScannerOrchestrator.onModuleInit + runAll
 *     -> StandardsMapper.mapFindingToStandards
 *     -> scanDir cleanup
 *
 * Validates: Requirements 4.4, 5.2, 5.3, 5.4, 6.8
 */
describe("GitHub ingestion -> classification -> scanning integration (fixture tarball)", () => {
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

  /** Temp paths (dirs + files) created during a test, cleaned up afterEach. */
  let tempPaths: string[] = [];

  const makeTempDir = (prefix: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempPaths.push(dir);
    return dir;
  };

  /**
   * Build a real gzipped tarball FILE on disk from the given entries, then
   * return a fresh read stream over that file. Mirrors how the processor
   * receives a tar stream, but the source is the local fixture (no network).
   * Entries must be prefixed with a top-level folder ("repo-main/") because
   * safeExtract uses `strip: 1` to drop the folder GitHub adds (Req 4.4).
   */
  const buildFixtureTarballStream = (
    entries: Record<string, string>,
  ): NodeJS.ReadableStream => {
    const staging = makeTempDir("ingest-staging-");
    for (const [rel, content] of Object.entries(entries)) {
      const full = path.join(staging, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }

    const tarballPath = path.join(
      makeTempDir("ingest-fixture-"),
      "repo.tar.gz",
    );
    tar.create(
      { gzip: true, cwd: staging, sync: true, file: tarballPath },
      Object.keys(entries),
    );
    tempPaths.push(tarballPath);

    return fs.createReadStream(tarballPath);
  };

  /** Recursively list files relative to baseDir (mirrors ScanProcessor.globFilesSync). */
  const globFilesSync = (dir: string, baseDir = dir): string[] => {
    const results: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        results.push(...globFilesSync(filePath, baseDir));
      } else {
        results.push(path.relative(baseDir, filePath));
      }
    }
    return results;
  };

  afterEach(() => {
    for (const p of tempPaths) {
      fs.rmSync(p, { recursive: true, force: true });
    }
    tempPaths = [];
  });

  it("extracts a fixture tarball, classifies files, produces standard-mapped findings, and cleans up", async () => {
    // A hardcoded AWS access key (AKIA + 16 chars) and an apiKey assignment
    // (20+ chars) both trip the SecretAnalyzer without any external binaries.
    const secretsSource = [
      "export const region = 'us-east-1';",
      "const awsAccessKey = 'AKIAIOSFODNN7EXAMPLE';",
      "const apiKey = 'sk_live_abcdef0123456789abcdef';",
      "export function connect() {",
      "  return { awsAccessKey, apiKey };",
      "}",
      "",
    ].join("\n");

    const appSource = [
      "import React from 'react';",
      "export function App() {",
      '  return <div className="app">Hello</div>;',
      "}",
      "",
    ].join("\n");

    const fixtureStream = buildFixtureTarballStream({
      "repo-main/src/secrets.ts": secretsSource,
      "repo-main/src/app.tsx": appSource,
      // Must be excluded (dependency directory).
      "repo-main/node_modules/dep.js": "module.exports = function dep() {};\n",
      // Must be excluded (binary file).
      "repo-main/logo.png": "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR",
    });

    const scanDir = makeTempDir("ingest-scan-");

    // 1. safeExtract from the fixture stream (no network). Only the two
    //    source files are written; node_modules + binary are excluded (Req 4.4).
    const extractResult = await service.safeExtract(fixtureStream, scanDir);
    expect(extractResult.fileCount).toBe(2);

    // node_modules + binary excluded; "repo-main/" stripped.
    expect(fs.existsSync(path.join(scanDir, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(scanDir, "logo.png"))).toBe(false);
    expect(fs.existsSync(path.join(scanDir, "src", "secrets.ts"))).toBe(true);
    expect(fs.existsSync(path.join(scanDir, "src", "app.tsx"))).toBe(true);

    // 2. Glob files (relative paths), mirroring the processor.
    const files = globFilesSync(scanDir);
    expect(files.map((f) => f.replace(/\\/g, "/")).sort()).toEqual([
      "src/app.tsx",
      "src/secrets.ts",
    ]);

    // 3. Classify files (Req 5.2): node_modules/binary absent; sources typed.
    const classified = new FileClassifier().classifyFiles(files);
    const classifiedPaths = classified.map((f) => f.path.replace(/\\/g, "/"));
    expect(classifiedPaths).not.toContain("node_modules/dep.js");
    expect(classifiedPaths).not.toContain("logo.png");

    const appTsx = classified.find(
      (f) => f.path.replace(/\\/g, "/") === "src/app.tsx",
    );
    expect(appTsx).toBeDefined();
    expect(appTsx?.language).toBe("TypeScript/JSX");
    expect(appTsx?.isFrontend).toBe(true);

    // 4. Build the AnalysisContext exactly as the processor does and run all
    //    available analyzers (Req 5.3, 5.4). External-binary analyzers gate
    //    themselves via isAvailable(); SecretAnalyzer + SlopAnalyzer run here.
    const orchestrator = new ScannerOrchestrator();
    await orchestrator.onModuleInit();

    const context: AnalysisContext = {
      scanDir,
      files: classified
        .filter((f) => f.fileType !== "dependency")
        .map((f) => f.path),
      scanId: "it-1",
    };
    // AnalysisContext is populated with the extracted scanDir + source files.
    expect(context.scanDir).toBe(scanDir);
    expect(context.files.length).toBeGreaterThan(0);

    const { findings } = await orchestrator.runAll(context);
    expect(Array.isArray(findings)).toBe(true);

    // The hardcoded secret must surface as a security finding.
    const securityFinding = findings.find((f) =>
      f.category.includes("security"),
    );
    expect(securityFinding).toBeDefined();

    // Req 6.8: findings carry non-empty standard references.
    expect(securityFinding?.standardReferences.length).toBeGreaterThan(0);

    // 5. Confirm StandardsMapper also yields >= 1 reference for the finding.
    const mapper = new StandardsMapper();
    const mapped = mapper.mapFindingToStandards({
      title: securityFinding!.title,
      category: securityFinding!.category,
      description: securityFinding!.whyItMatters,
    });
    expect(mapped.length).toBeGreaterThanOrEqual(1);

    // 6. Clean up scanDir and assert it is gone (mirrors processor cleanup).
    fs.rmSync(scanDir, { recursive: true, force: true });
    expect(fs.existsSync(scanDir)).toBe(false);
  }, 60_000);
});
