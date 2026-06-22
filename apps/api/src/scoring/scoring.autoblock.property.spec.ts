// Feature: github-repository-scanner, Property 10
//
// Property 10: Auto-block override.
// Validates: Requirements 7.3, 7.4, 7.5
//
// For any set of findings, if at least one finding is blocking / matches an
// AUTO_BLOCK_CONDITION, then calculateScore() must return
// statusResult === "blocked" REGARDLESS of the otherwise-computed overall
// score, and must record a non-empty list of blocking reasons. Conversely, a
// set of only benign, non-blocking findings must NOT be force-blocked — the
// status follows directly from the computed score.

import fc from "fast-check";
import {
  Finding,
  FindingCategory,
  AUTO_BLOCK_CONDITIONS,
  getScoreStatus,
} from "@slopshield/shared";

import { ScoringService } from "./scoring.service";

describe("ScoringService — Property 10: Auto-block override", () => {
  const service = new ScoringService();

  /**
   * Builds a benign, non-blocking finding. Benign findings use only low/info
   * severity and blocking:false so that they can never trigger an auto-block.
   */
  const benignFindingArbitrary = (index: number): fc.Arbitrary<Finding> =>
    fc
      .record({
        severity: fc.constantFrom("low" as const, "info" as const),
        category: fc.constantFrom(
          "maintainability" as FindingCategory,
          "documentation" as FindingCategory,
          "reliability" as FindingCategory,
          "general" as FindingCategory,
        ),
        title: fc
          .string()
          // Avoid accidentally containing an auto-block condition title.
          .map((s) => `Benign issue ${index} ${s}`),
        confidence: fc.float({ min: 0, max: 1, noNaN: true }),
      })
      .map(
        ({ severity, category, title, confidence }): Finding => ({
          id: `benign-${index}`,
          scanId: "scan-1",
          severity,
          category,
          title,
          file: "src/app.ts",
          standardReferences: [],
          whyItMatters: "Minor stylistic concern.",
          recommendation: "Consider tidying up.",
          blocking: false,
          confidence,
          source: "eslint",
        }),
      );

  // A blocking finding built to match a real AUTO_BLOCK_CONDITION: it sets
  // blocking:true and copies the condition's category and title.
  const blockingFindingArbitrary: fc.Arbitrary<Finding> = fc
    .constantFrom(...AUTO_BLOCK_CONDITIONS)
    .map(
      (condition): Finding => ({
        id: `blocking-${condition.id}`,
        scanId: "scan-1",
        severity: "critical",
        category: condition.category,
        title: condition.title,
        file: "src/secrets.ts",
        standardReferences: [],
        whyItMatters: condition.description,
        recommendation: "Remediate before merge.",
        blocking: true,
        confidence: 1,
        source: "rules-engine",
      }),
    );

  it("forces statusResult to 'blocked' with a non-empty reason whenever a blocking finding is present", () => {
    fc.assert(
      fc.property(
        // 0..8 benign findings interleaved around one blocking finding.
        fc.array(
          fc.nat({ max: 4 }).chain((i) => benignFindingArbitrary(i)),
          {
            maxLength: 8,
          },
        ),
        blockingFindingArbitrary,
        fc.nat({ max: 8 }),
        (benign, blocking, insertAt) => {
          const findings = [...benign];
          const pos = Math.min(insertAt, findings.length);
          findings.splice(pos, 0, blocking);

          const result = service.calculateScore(findings);

          // Auto-block override: regardless of the computed overall score,
          // the verdict must be "blocked".
          expect(result.statusResult).toBe("blocked");
          // And a blocking reason must be recorded.
          expect(result.blockedReasons.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("does NOT force-block when only benign, non-blocking findings are present (status follows the score)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.nat({ max: 4 }).chain((i) => benignFindingArbitrary(i)),
          {
            maxLength: 10,
          },
        ),
        (benign) => {
          const result = service.calculateScore(benign);

          // No blocking findings means no auto-block reasons.
          expect(result.blockedReasons.length).toBe(0);
          // Status must follow purely from the computed score.
          expect(result.statusResult).toBe(getScoreStatus(result.overallScore));
        },
      ),
      { numRuns: 100 },
    );
  });
});
