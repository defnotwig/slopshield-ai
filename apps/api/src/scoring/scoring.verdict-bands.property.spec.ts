// Feature: production-grade-system, Property 22: Verdict follows the documented score bands
//
// Validates: Requirements 7.2
//
// For any set of non-blocking findings (no auto-block triggered), the
// statusResult assigned by ScoringService.calculateScore must follow the
// documented score bands applied to the computed overallScore:
//   90–100 → "passed"
//   80–89  → "passed-with-warnings"
//   70–79  → "needs-cleanup"
//   60–69  → "risky"
//   0–59   → "blocked"
//
// This property tests the full scoring pipeline (deductions, weighted average,
// rounding, and verdict assignment) rather than getScoreStatus in isolation.

import fc from "fast-check";
import {
  Finding,
  FindingCategory,
  FindingSeverity,
  ScanStatusResult,
} from "@slopshield/shared";

import { ScoringService } from "./scoring.service";

/**
 * Independent oracle for the documented score-band mapping.
 * Implemented separately from the production SCORE_THRESHOLDS so we don't
 * just re-derive the implementation.
 */
function expectedBandFromScore(score: number): ScanStatusResult {
  if (score >= 90) return "passed";
  if (score >= 80) return "passed-with-warnings";
  if (score >= 70) return "needs-cleanup";
  if (score >= 60) return "risky";
  return "blocked";
}

/**
 * All finding categories (excluding "general" which has 0 weight).
 */
const WEIGHTED_CATEGORIES: FindingCategory[] = [
  "backend-security",
  "frontend-security",
  "backend-architecture",
  "frontend-architecture",
  "maintainability",
  "testability",
  "accessibility",
  "reliability",
  "documentation",
];

/**
 * All severity levels available for non-blocking findings.
 */
const ALL_SEVERITIES: FindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

/**
 * Generates a valid non-blocking Finding with the given severity and category.
 * The title is kept harmless (no auto-block condition keywords).
 */
function makeFinding(
  index: number,
  severity: FindingSeverity,
  category: FindingCategory,
): Finding {
  return {
    id: `finding-${index}`,
    scanId: "scan-test",
    severity,
    category,
    title: `Test finding ${index}`,
    file: `src/file-${index}.ts`,
    standardReferences: [],
    whyItMatters: "Test concern.",
    recommendation: "Fix it.",
    blocking: false,
    confidence: 0.8,
    source: "eslint",
  };
}

/**
 * Arbitrary that generates a list of non-blocking findings with random
 * severities distributed across weighted categories. This exercises the
 * full scoring pipeline with varied inputs.
 */
const nonBlockingFindingsArbitrary: fc.Arbitrary<Finding[]> = fc
  .array(
    fc.record({
      severity: fc.constantFrom(...ALL_SEVERITIES),
      category: fc.constantFrom(...WEIGHTED_CATEGORIES),
    }),
    { minLength: 0, maxLength: 20 },
  )
  .map((items) =>
    items.map((item, i) => makeFinding(i, item.severity, item.category)),
  );

describe("ScoringService — Property 22: Verdict follows the documented score bands", () => {
  const service = new ScoringService();

  it("assigns statusResult matching the documented band for any non-blocking finding set", () => {
    fc.assert(
      fc.property(nonBlockingFindingsArbitrary, (findings) => {
        const result = service.calculateScore(findings);

        // No blocking reasons should be present (findings are all non-blocking).
        expect(result.blockedReasons).toHaveLength(0);

        // The overall score must be in [0, 100].
        expect(result.overallScore).toBeGreaterThanOrEqual(0);
        expect(result.overallScore).toBeLessThanOrEqual(100);

        // The verdict must follow the documented bands based on overallScore.
        const expected = expectedBandFromScore(result.overallScore);
        expect(result.statusResult).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("produces 'passed' when there are zero findings (perfect score)", () => {
    fc.assert(
      fc.property(fc.constant([]), (findings: Finding[]) => {
        const result = service.calculateScore(findings);
        expect(result.overallScore).toBe(100);
        expect(result.statusResult).toBe("passed");
      }),
      { numRuns: 100 },
    );
  });

  it("produces the correct band at boundary-inducing finding counts", () => {
    // Generate findings targeting a single category to exercise precise score control.
    // Using "maintainability" (weight 0.2) with various severity counts.
    fc.assert(
      fc.property(
        fc.record({
          category: fc.constantFrom(...WEIGHTED_CATEGORIES),
          severity: fc.constantFrom(...ALL_SEVERITIES),
          count: fc.integer({ min: 1, max: 15 }),
        }),
        ({ category, severity, count }) => {
          const findings = Array.from({ length: count }, (_, i) =>
            makeFinding(i, severity, category),
          );
          const result = service.calculateScore(findings);

          // Verify the verdict follows the oracle for whatever score was computed.
          const expected = expectedBandFromScore(result.overallScore);
          expect(result.statusResult).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
