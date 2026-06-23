// Feature: production-grade-system, Task 9.7
//
// Unit tests for analyzer configuration robustness:
//   - ESLint uses a BUNDLED baseline config, never the scanned repo's config (5.3)
//   - TypeScript RESPECTS a repo tsconfig.json when present (5.4) and falls back
//     to a lenient baseline when absent (5.5), assigning lower confidence to
//     inferred/fallback diagnostics (5.6, supporting 5.5)
//   - Semgrep records `skipped` (not `failed`) when its CLI is unavailable (5.7)
//
// These are example-based unit tests using fixture repos created on disk; they
// complement the property tests (Properties 16, 17) with concrete scenarios.
//
// Validates: Requirements 5.3, 5.4, 5.5, 5.7

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  AnalysisContext,
  ESLintAnalyzer,
  SemgrepAnalyzer,
  TypeScriptAnalyzer,
} from "@slopshield/scanner-plugins";

/** Creates an isolated temp scan directory. */
function makeScanDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Best-effort recursive cleanup. */
function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Writes a file under `dir`, creating parent directories as needed. */
function writeFile(dir: string, relPath: string, contents: string): void {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

describe("ESLintAnalyzer — bundled baseline config (Req 5.3)", () => {
  const analyzer = new ESLintAnalyzer();
  const dirs: string[] = [];

  afterAll(() => {
    for (const d of dirs) rmDir(d);
  });

  function newDir(): string {
    const d = makeScanDir("eslint-cfg-");
    dirs.push(d);
    return d;
  }

  it("flags violations of the bundled rules even when the repo has NO ESLint config", async () => {
    if (!(await analyzer.isAvailable())) return; // vacuous without eslint

    const dir = newDir();
    // `eval` and `debugger` violate the bundled baseline (no-eval / no-debugger).
    writeFile(dir, "bad.js", "eval('1 + 1');\ndebugger;\n");

    const ctx: AnalysisContext = {
      scanDir: dir,
      files: ["bad.js"],
      scanId: "eslint-no-config",
    };

    const result = await analyzer.analyze(ctx);

    expect(result.success).toBe(true);
    const titles = result.findings.map((f) => f.title.toLowerCase());
    // Bundled rules fired despite there being no repo config at all.
    expect(titles.some((t) => t.includes("eval"))).toBe(true);
    expect(titles.some((t) => t.includes("debugger"))).toBe(true);
  });

  it("ignores a hostile repo ESLint config that disables the bundled rules", async () => {
    if (!(await analyzer.isAvailable())) return;

    const dir = newDir();
    // A repo config that tries to turn OFF our security/quality rules. If the
    // analyzer respected repo config, these violations would be suppressed.
    writeFile(
      dir,
      "eslint.config.js",
      "module.exports = [{ rules: { 'no-eval': 'off', 'no-debugger': 'off', 'no-console': 'off' } }];\n",
    );
    // Legacy config too, to cover both resolution strategies.
    writeFile(
      dir,
      ".eslintrc.json",
      JSON.stringify({ rules: { "no-eval": "off", "no-debugger": "off" } }),
    );
    writeFile(dir, "bad.js", "eval('1 + 1');\ndebugger;\n");

    const ctx: AnalysisContext = {
      scanDir: dir,
      files: ["bad.js"],
      scanId: "eslint-hostile-config",
    };

    const result = await analyzer.analyze(ctx);

    expect(result.success).toBe(true);
    const titles = result.findings.map((f) => f.title.toLowerCase());
    // Bundled config wins: the repo's "off" settings are ignored.
    expect(titles.some((t) => t.includes("eval"))).toBe(true);
    expect(titles.some((t) => t.includes("debugger"))).toBe(true);
  });
});

describe("TypeScriptAnalyzer — repo tsconfig vs lenient fallback (Req 5.4, 5.5)", () => {
  const analyzer = new TypeScriptAnalyzer();
  const dirs: string[] = [];

  afterAll(() => {
    for (const d of dirs) rmDir(d);
  });

  function newDir(prefix: string): string {
    const d = makeScanDir(prefix);
    dirs.push(d);
    return d;
  }

  // A source file that is fine under loose typing but errors under `strict`
  // (implicit-any parameter -> TS7006). Used to prove the repo tsconfig is
  // actually respected.
  const STRICT_ONLY_ERROR_SRC = "export function f(a) {\n  return a + 1;\n}\n";

  // A source file with an unconditional type error (TS2322) that surfaces under
  // BOTH strict and lenient configs. Used to compare confidence between modes.
  const ALWAYS_ERROR_SRC = 'const n: number = "not a number";\n';

  it("respects a repo tsconfig.json (strict mode produces diagnostics it otherwise would not)", async () => {
    if (!(await analyzer.isAvailable())) return;

    const dir = newDir("ts-repo-strict-");
    writeFile(
      dir,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noImplicitAny: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["**/*.ts"],
      }),
    );
    writeFile(dir, "src/sample.ts", STRICT_ONLY_ERROR_SRC);

    const ctx: AnalysisContext = {
      scanDir: dir,
      files: ["src/sample.ts"],
      scanId: "ts-repo-strict",
    };

    const result = await analyzer.analyze(ctx);

    expect(result.success).toBe(true);
    // strict/noImplicitAny in the repo config produces the implicit-any error.
    expect(result.findings.length).toBeGreaterThan(0);
    // Diagnostics produced from the repo's own config carry full confidence.
    for (const f of result.findings) {
      expect(f.confidence).toBe(1);
    }
  });

  it("falls back to a lenient baseline when the repo has NO tsconfig.json (implicit-any not reported)", async () => {
    if (!(await analyzer.isAvailable())) return;

    const dir = newDir("ts-lenient-");
    // No tsconfig.json on purpose.
    writeFile(dir, "src/sample.ts", STRICT_ONLY_ERROR_SRC);

    const ctx: AnalysisContext = {
      scanDir: dir,
      files: ["src/sample.ts"],
      scanId: "ts-lenient",
    };

    const result = await analyzer.analyze(ctx);

    expect(result.success).toBe(true);
    // The lenient baseline does not enable strict/noImplicitAny, so the
    // implicit-any-only program produces no diagnostics.
    const implicitAny = result.findings.filter((f) =>
      f.title.includes("TS7006"),
    );
    expect(implicitAny.length).toBe(0);
  });

  it("assigns lower confidence to fallback diagnostics than to repo-config diagnostics for the same error", async () => {
    if (!(await analyzer.isAvailable())) return;

    // Repo-config mode.
    const repoDir = newDir("ts-conf-repo-");
    writeFile(
      repoDir,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["**/*.ts"],
      }),
    );
    writeFile(repoDir, "src/sample.ts", ALWAYS_ERROR_SRC);

    // Inferred/fallback mode (no tsconfig.json).
    const inferDir = newDir("ts-conf-infer-");
    writeFile(inferDir, "src/sample.ts", ALWAYS_ERROR_SRC);

    const repoResult = await analyzer.analyze({
      scanDir: repoDir,
      files: ["src/sample.ts"],
      scanId: "ts-conf-repo",
    });
    const inferResult = await analyzer.analyze({
      scanDir: inferDir,
      files: ["src/sample.ts"],
      scanId: "ts-conf-infer",
    });

    expect(repoResult.findings.length).toBeGreaterThan(0);
    expect(inferResult.findings.length).toBeGreaterThan(0);

    const repoConfidence = repoResult.findings[0].confidence;
    const inferConfidence = inferResult.findings[0].confidence;
    expect(repoConfidence).toBe(1);
    expect(inferConfidence).toBeLessThan(repoConfidence);
  });
});

describe("SemgrepAnalyzer — skipped when unavailable (Req 5.7)", () => {
  const analyzer = new SemgrepAnalyzer();

  it("records a skipped result (not a hard failure) when the Semgrep CLI is unavailable", async () => {
    const available = await analyzer.isAvailable();

    const dir = makeScanDir("semgrep-skip-");
    try {
      writeFile(dir, "sample.js", "const x = 1;\n");
      const result = await analyzer.analyze({
        scanDir: dir,
        files: ["sample.js"],
        scanId: "semgrep-skip",
      });

      if (available) {
        // If a real Semgrep is installed in this environment, the analyzer is
        // expected to actually run rather than skip.
        expect(result.skipped).not.toBe(true);
      } else {
        // The contract under test: unavailable Semgrep must be `skipped`, never
        // a finding-producing success, and must not throw.
        expect(result.skipped).toBe(true);
        expect(result.findings).toEqual([]);
        expect(result.error).toMatch(/semgrep/i);
      }
    } finally {
      rmDir(dir);
    }
  });
});
