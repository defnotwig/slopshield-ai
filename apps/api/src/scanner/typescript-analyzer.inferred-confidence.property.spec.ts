// Feature: production-grade-system, Property 17: Inferred TypeScript diagnostics carry lower confidence
//
// Property 17: Inferred TypeScript diagnostics carry lower confidence.
// Validates: Requirements 5.6
//
// For any TypeScript diagnostic, a diagnostic produced from inferred or
// fallback configuration is assigned a STRICTLY LOWER confidence than the same
// diagnostic produced from the repository's own `tsconfig.json`.
//
// Strategy: fast-check generates TypeScript source files that deterministically
// produce one or more compiler diagnostics (assignment-type errors, TS2322,
// which are reported under both strict and lenient configurations — so the SAME
// diagnostic appears in both modes and the only variable under test is the
// `confidence` the analyzer assigns). For each generated file we run the real
// `TypeScriptAnalyzer` twice:
//   (A) repo-config mode  — the scan directory contains a real `tsconfig.json`.
//   (B) inferred mode     — the scan directory has NO `tsconfig.json`, forcing
//                           the analyzer onto its lenient fallback baseline.
// We then match findings produced in both modes by (file, line, title) and
// assert that every inferred-mode diagnostic carries strictly lower confidence
// than its repo-config counterpart.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  AnalysisContext,
  TypeScriptAnalyzer,
} from "@slopshield/scanner-plugins";
import { Finding } from "@slopshield/shared";
import fc from "fast-check";

type NormalizedFinding = Omit<Finding, "id" | "scanId">;

/**
 * A realistic repository tsconfig.json. The exact options are not important to
 * the property — what matters is that the file exists, so the analyzer treats
 * the diagnostics as coming from the repository's own configuration.
 */
const REPO_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ["**/*.ts", "**/*.tsx"],
  },
  null,
  2,
);

/**
 * Generates a TypeScript source file whose body is a sequence of
 * type-assignment errors. `const <id>: number = "<str>";` produces TS2322
 * ("Type 'string' is not assignable to type 'number'") regardless of whether
 * strict mode is enabled, guaranteeing the identical diagnostic surfaces under
 * both the repo config and the lenient fallback.
 */
const erroringSourceArb: fc.Arbitrary<string> = fc
  .array(
    fc.record({
      id: fc
        .stringMatching(/^[a-z][a-z0-9]{0,7}$/)
        .filter((s) => s.length > 0),
      value: fc.stringMatching(/^[a-zA-Z0-9 ]{0,12}$/),
    }),
    { minLength: 1, maxLength: 4 },
  )
  // De-duplicate identifiers so each statement is a distinct, valid declaration
  // (a redeclaration would change which diagnostics are emitted).
  .map((decls) => {
    const seen = new Set<string>();
    const unique = decls.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
    if (unique.length === 0) {
      unique.push({ id: "x", value: "oops" });
    }
    return unique
      .map((d, i) => `const ${d.id}_${i}: number = "${d.value}";`)
      .join("\n");
  });

/** Stable identity for a diagnostic so we can match it across the two runs. */
function key(f: NormalizedFinding): string {
  return `${f.file}::${f.line}::${f.title}`;
}

function makeScanDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

describe("TypeScriptAnalyzer — Property 17: Inferred TypeScript diagnostics carry lower confidence", () => {
  const analyzer = new TypeScriptAnalyzer();

  it("assigns strictly lower confidence to diagnostics from inferred/fallback config than from the repo's own tsconfig.json", async () => {
    // Skip cleanly if TypeScript is not resolvable in this environment; the
    // property is vacuous without a working compiler.
    if (!(await analyzer.isAvailable())) {
      return;
    }

    await fc.assert(
      fc.asyncProperty(erroringSourceArb, async (source) => {
        const repoDir = makeScanDir("ts17-repo-");
        const inferDir = makeScanDir("ts17-infer-");
        try {
          const fileName = "src/sample.ts";
          // (A) Repo-config mode: scan dir contains its own tsconfig.json.
          fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
          fs.writeFileSync(path.join(repoDir, "tsconfig.json"), REPO_TSCONFIG);
          fs.writeFileSync(path.join(repoDir, fileName), source);

          // (B) Inferred mode: NO tsconfig.json -> lenient fallback baseline.
          fs.mkdirSync(path.join(inferDir, "src"), { recursive: true });
          fs.writeFileSync(path.join(inferDir, fileName), source);

          const repoCtx: AnalysisContext = {
            scanDir: repoDir,
            files: [fileName],
            scanId: "repo-scan",
          };
          const inferCtx: AnalysisContext = {
            scanDir: inferDir,
            files: [fileName],
            scanId: "infer-scan",
          };

          const repoResult = await analyzer.analyze(repoCtx);
          const inferResult = await analyzer.analyze(inferCtx);

          // The generated source is guaranteed to contain type errors, so both
          // runs must surface at least one diagnostic; otherwise the analyzer
          // is silently dropping repo diagnostics and the property is moot.
          expect(repoResult.findings.length).toBeGreaterThan(0);
          expect(inferResult.findings.length).toBeGreaterThan(0);

          const repoByKey = new Map<string, NormalizedFinding>();
          for (const f of repoResult.findings) {
            repoByKey.set(key(f), f);
          }

          // Match diagnostics present in BOTH runs by (file, line, title) and
          // assert the inferred-mode confidence is strictly lower.
          let matched = 0;
          for (const inferF of inferResult.findings) {
            const repoF = repoByKey.get(key(inferF));
            if (!repoF) continue;
            matched += 1;
            expect(inferF.confidence).toBeLessThan(repoF.confidence);
          }

          // There must be at least one shared diagnostic to compare; the
          // identical source under both configs guarantees overlap.
          expect(matched).toBeGreaterThan(0);
        } finally {
          rmDir(repoDir);
          rmDir(inferDir);
        }
      }),
      { numRuns: 100 },
    );
  });
});
