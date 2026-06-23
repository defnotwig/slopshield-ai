// Feature: production-grade-system, Property 16: Every analyzer has exactly one recorded status and failures are isolated
//
// Property 16: For any set of analyzers with arbitrary outcomes (succeed,
// throw, return success:false, time out, or be unavailable),
// ScannerOrchestrator.runAll records exactly one AnalyzerCoverage status of
// `ran`, `skipped`, or `failed` for each analyzer, and a single analyzer's
// failure never aborts the scan — the remaining analyzers still run.
//
// Validates: Requirements 5.1, 5.2, 5.8

import { Logger } from "@nestjs/common";
import {
  AnalysisContext,
  AnalysisResult,
  StaticAnalyzer,
} from "@slopshield/scanner-plugins";
import { Finding } from "@slopshield/shared";
import fc from "fast-check";
import { ScannerOrchestrator } from "./scanner.orchestrator";

// Small deterministic timeout keeps fake-timer advancement fast.
const ANALYZER_TIMEOUT_MS = 1000;

// Each kind exercises a distinct path of the orchestrator's status recording
// and failure-isolation logic:
//   success      -> resolves with success:true            -> status "ran"
//   successFalse -> resolves with success:false            -> status "failed"
//   throw        -> analyze() rejects                       -> status "failed"
//   hang         -> analyze() never settles (timeout)       -> status "failed"
//   unavailable  -> isAvailable() === false                 -> status "skipped"
type AnalyzerKind =
  | "success"
  | "successFalse"
  | "throw"
  | "hang"
  | "unavailable";

interface AnalyzerSpec {
  kind: AnalyzerKind;
  findings: Omit<Finding, "id" | "scanId">[];
}

const CONTEXT: AnalysisContext = {
  scanDir: "/tmp/scan",
  files: [],
  scanId: "scan-1",
};

const findingArb: fc.Arbitrary<Omit<Finding, "id" | "scanId">> = fc
  .record({
    severity: fc.constantFrom("critical", "high", "medium", "low", "info"),
    category: fc.constantFrom(
      "backend-security",
      "frontend-security",
      "maintainability",
      "general",
    ),
    title: fc.string({ minLength: 1, maxLength: 16 }),
    file: fc.string({ minLength: 1, maxLength: 16 }),
    standardReferences: fc.array(fc.string({ maxLength: 8 }), { maxLength: 2 }),
    whyItMatters: fc.string({ maxLength: 16 }),
    recommendation: fc.string({ maxLength: 16 }),
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
    "successFalse",
    "throw",
    "hang",
    "unavailable",
  ),
  findings: fc.array(findingArb, { maxLength: 3 }),
});

function makeAnalyzer(spec: AnalyzerSpec, index: number): StaticAnalyzer {
  const name = `mock-analyzer-${index}`;
  return {
    name,
    description: `mock ${spec.kind}`,
    isAvailable: async (): Promise<boolean> => spec.kind !== "unavailable",
    analyze: async (): Promise<AnalysisResult> => {
      if (spec.kind === "throw") {
        throw new Error(`analyzer ${name} threw`);
      }
      if (spec.kind === "hang") {
        // Never resolves; the orchestrator's timeout wrapper must trip.
        return new Promise<AnalysisResult>(() => {});
      }
      return {
        analyzerName: name,
        success: spec.kind === "success",
        findings: spec.kind === "success" ? spec.findings : [],
        error: spec.kind === "successFalse" ? "self-reported failure" : undefined,
        durationMs: 1,
      };
    },
  };
}

const VALID_STATUSES = new Set(["ran", "skipped", "failed"]);

describe("ScannerOrchestrator.runAll — Property 16: analyzer status + failure isolation", () => {
  beforeAll(() => {
    process.env.ANALYZER_TIMEOUT_MS = String(ANALYZER_TIMEOUT_MS);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
    delete process.env.ANALYZER_TIMEOUT_MS;
  });

  it("records exactly one ran/skipped/failed status per analyzer and isolates failures", async () => {
    jest.useFakeTimers();
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.array(analyzerSpecArb, { minLength: 0, maxLength: 8 }),
          async (specs) => {
            const orchestrator = new ScannerOrchestrator();
            const analyzers = specs.map((spec, i) => makeAnalyzer(spec, i));
            (
              orchestrator as unknown as { analyzers: StaticAnalyzer[] }
            ).analyzers = analyzers;

            const runPromise = orchestrator.runAll(CONTEXT);

            // Advance past the timeout while flushing microtasks so
            // isAvailable()/analyze() promises settle and hung analyzers trip.
            await jest.advanceTimersByTimeAsync(ANALYZER_TIMEOUT_MS + 100);

            // runAll must resolve, never reject — a thrown/hung analyzer must
            // not abort the scan.
            const { findings, coverage } = await runPromise;

            // Exactly one coverage record per analyzer.
            expect(coverage.length).toBe(specs.length);

            // Every status is one of the three allowed values.
            for (const c of coverage) {
              expect(VALID_STATUSES.has(c.status)).toBe(true);
              expect(c.findingCount).toBeGreaterThanOrEqual(0);
              expect(c.durationMs).toBeGreaterThanOrEqual(0);
            }

            // Status counts match the expected outcome per kind.
            const expectedRan = specs.filter((s) => s.kind === "success").length;
            const expectedSkipped = specs.filter(
              (s) => s.kind === "unavailable",
            ).length;
            const expectedFailed = specs.filter((s) =>
              ["throw", "hang", "successFalse"].includes(s.kind),
            ).length;

            const ran = coverage.filter((c) => c.status === "ran");
            const skipped = coverage.filter((c) => c.status === "skipped");
            const failed = coverage.filter((c) => c.status === "failed");

            expect(ran.length).toBe(expectedRan);
            expect(skipped.length).toBe(expectedSkipped);
            expect(failed.length).toBe(expectedFailed);

            // Failure isolation: every succeeding analyzer still ran and
            // contributed its findings, regardless of co-located failures.
            const expectedFindings = specs
              .filter((s) => s.kind === "success")
              .flatMap((s) => s.findings);
            expect(findings).toEqual(expectedFindings);

            // Findings only ever come from analyzers recorded as "ran".
            const ranFindingTotal = ran.reduce(
              (sum, c) => sum + c.findingCount,
              0,
            );
            expect(ranFindingTotal).toBe(expectedFindings.length);

            // Failed/skipped analyzers never report findings.
            for (const c of [...failed, ...skipped]) {
              expect(c.findingCount).toBe(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
