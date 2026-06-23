// Feature: backend-hosting-live-mode, Property 4
//
// Property 4: Analyzer timeout/failure degrades gracefully.
// Validates: Requirements 8.3, 8.5
//
// For any set of analyzers where some succeed quickly, some throw, some are
// unavailable (isAvailable() === false), and some hang past
// ANALYZER_TIMEOUT_MS, ScannerOrchestrator.runAll resolves (never rejects) and
// the returned findings are exactly the union of the fast-succeeding
// analyzers' findings — hung, failed, and unavailable analyzers are excluded.

import { Logger } from "@nestjs/common";
import {
  AnalysisContext,
  AnalysisResult,
  StaticAnalyzer,
} from "@slopshield/scanner-plugins";
import { Finding } from "@slopshield/shared";
import fc from "fast-check";
import { ScannerOrchestrator } from "./scanner.orchestrator";

// A deterministic, small timeout keeps fake-timer advancement fast and obvious.
const ANALYZER_TIMEOUT_MS = 1000;

type AnalyzerKind = "success" | "throw" | "unavailable" | "hang";

interface AnalyzerSpec {
  kind: AnalyzerKind;
  findings: Omit<Finding, "id" | "scanId">[];
}

const CONTEXT: AnalysisContext = {
  scanDir: "/tmp/scan",
  files: [],
  scanId: "scan-1",
};

// A minimal but distinguishable finding generator. Equality is structural, so
// the union built by the test matches what runAll pushes through verbatim.
const findingArb: fc.Arbitrary<Omit<Finding, "id" | "scanId">> = fc
  .record({
    severity: fc.constantFrom("critical", "high", "medium", "low", "info"),
    category: fc.constantFrom(
      "backend-security",
      "frontend-security",
      "maintainability",
      "general",
    ),
    title: fc.string({ minLength: 1, maxLength: 24 }),
    file: fc.string({ minLength: 1, maxLength: 24 }),
    standardReferences: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
    whyItMatters: fc.string({ maxLength: 24 }),
    recommendation: fc.string({ maxLength: 24 }),
    blocking: fc.boolean(),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    source: fc.constantFrom(
      "eslint",
      "typescript",
      "secret-scanner",
      "semgrep",
      "rules-engine",
      "ai-reviewer",
    ),
  })
  .map((f) => f as Omit<Finding, "id" | "scanId">);

const analyzerSpecArb: fc.Arbitrary<AnalyzerSpec> = fc.record({
  kind: fc.constantFrom<AnalyzerKind>(
    "success",
    "throw",
    "unavailable",
    "hang",
  ),
  findings: fc.array(findingArb, { maxLength: 4 }),
});

// Build a mock analyzer from a spec. Each kind exercises a distinct path of the
// orchestrator's failure isolation:
//   success     -> resolves immediately with findings
//   throw       -> analyze() rejects (caught by runAll's try/catch)
//   unavailable -> isAvailable() === false (filtered out before running)
//   hang        -> analyze() never settles (tripped by runWithTimeout)
function makeAnalyzer(spec: AnalyzerSpec, index: number): StaticAnalyzer {
  const name = `mock-analyzer-${index}`;
  return {
    name,
    description: `mock ${spec.kind}`,
    isAvailable: async (): Promise<boolean> => spec.kind !== "unavailable",
    analyze: async (): Promise<AnalysisResult> => {
      if (spec.kind === "throw") {
        throw new Error(`analyzer ${name} failed`);
      }
      if (spec.kind === "hang") {
        // Never resolves; the orchestrator's timeout wrapper must trip.
        return new Promise<AnalysisResult>(() => {});
      }
      return {
        analyzerName: name,
        success: true,
        findings: spec.findings,
        durationMs: 1,
      };
    },
  };
}

describe("ScannerOrchestrator.runAll — Property 4: Analyzer timeout/failure degrades gracefully", () => {
  beforeAll(() => {
    // Read by the orchestrator at field initialization time.
    process.env.ANALYZER_TIMEOUT_MS = String(ANALYZER_TIMEOUT_MS);
    // Silence the orchestrator's per-analyzer logging across many iterations.
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
    delete process.env.ANALYZER_TIMEOUT_MS;
  });

  it("resolves with exactly the union of fast-succeeding analyzers' findings", async () => {
    jest.useFakeTimers();
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.array(analyzerSpecArb, { minLength: 0, maxLength: 8 }),
          async (specs) => {
            const orchestrator = new ScannerOrchestrator();
            const analyzers = specs.map((spec, i) => makeAnalyzer(spec, i));
            // Inject mock analyzers directly, bypassing onModuleInit.
            (
              orchestrator as unknown as { analyzers: StaticAnalyzer[] }
            ).analyzers = analyzers;

            const runPromise = orchestrator.runAll(CONTEXT);

            // Advance past the timeout while flushing the microtask queue so
            // isAvailable()/analyze() promises settle and hung analyzers trip.
            await jest.advanceTimersByTimeAsync(ANALYZER_TIMEOUT_MS + 100);

            // runAll must resolve, never reject.
            const { findings, coverage } = await runPromise;

            // Expected = union of findings from fast-succeeding analyzers, in
            // their original registration order. Hung/throwing/unavailable
            // analyzers contribute nothing.
            const expected = specs
              .filter((s) => s.kind === "success")
              .flatMap((s) => s.findings);

            expect(Array.isArray(findings)).toBe(true);
            expect(findings).toEqual(expected);

            // Coverage must record one entry per analyzer (ran/failed/skipped),
            // so total coverage records equals the number of analyzers.
            expect(coverage.length).toBe(specs.length);
            const ranCount = coverage.filter((c) => c.status === "ran").length;
            const skippedCount = coverage.filter(
              (c) => c.status === "skipped",
            ).length;
            expect(ranCount).toBe(
              specs.filter((s) => s.kind === "success").length,
            );
            expect(skippedCount).toBe(
              specs.filter((s) => s.kind === "unavailable").length,
            );
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
