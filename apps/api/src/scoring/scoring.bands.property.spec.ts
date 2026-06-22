// Feature: github-repository-scanner, Property 9
//
// Property 9: Score-band correctness.
// Validates: Requirements 7.1, 7.2
//
// For any integer score in [0, 100], getScoreStatus(score) must return the
// band dictated by the documented SCORE_THRESHOLDS, and must be correct at the
// band boundaries (90, 89, 80, 79, 70, 69, 60, 59). The expected band is
// computed with an independent oracle that mirrors the documented thresholds:
//   score >= 90 -> "passed"
//   score >= 80 -> "passed-with-warnings"
//   score >= 70 -> "needs-cleanup"
//   score >= 60 -> "risky"
//   otherwise   -> "blocked"

import fc from "fast-check";
import { getScoreStatus, ScanStatusResult } from "@slopshield/shared";

/**
 * Independent oracle for the documented score-band mapping.
 * Intentionally implemented separately from the production threshold table
 * so the property test does not just re-derive the implementation.
 */
function expectedBand(score: number): ScanStatusResult {
  if (score >= 90) return "passed";
  if (score >= 80) return "passed-with-warnings";
  if (score >= 70) return "needs-cleanup";
  if (score >= 60) return "risky";
  return "blocked";
}

describe("getScoreStatus — Property 9: Score-band correctness", () => {
  it("maps any integer score in [0,100] to the documented band", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (score) => {
        expect(getScoreStatus(score)).toBe(expectedBand(score));
      }),
      { numRuns: 1000 },
    );
  });

  // Explicit boundary assertions for every band edge.
  it.each([
    [100, "passed"],
    [90, "passed"],
    [89, "passed-with-warnings"],
    [80, "passed-with-warnings"],
    [79, "needs-cleanup"],
    [70, "needs-cleanup"],
    [69, "risky"],
    [60, "risky"],
    [59, "blocked"],
    [0, "blocked"],
  ] as [number, ScanStatusResult][])(
    "score %i maps to band %s",
    (score, expected) => {
      expect(getScoreStatus(score)).toBe(expected);
    },
  );
});
