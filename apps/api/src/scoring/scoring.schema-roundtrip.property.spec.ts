// Feature: production-grade-system, Property 21: Scoring output is well-formed, schema-conformant, and round-trips through persistence
//
// **Validates: Requirements 7.1, 7.4, 7.6**
//
// For any set of findings (arbitrary combinations of severity and category),
// the ScoringService.calculateScore output:
//   1. Conforms to ScanScoreSchema (overallScore 0-100, per-category scores
//      0-100, statusResult from valid verdicts, correct severity counts).
//   2. Round-trips through JSON serialization/deserialization without data loss.

import fc from "fast-check";
import { ScoringService } from "./scoring.service";
import {
  Finding,
  FindingSeverityEnum,
  FindingCategoryEnum,
  FindingSourceEnum,
  ScanScoreSchema,
} from "@slopshield/shared";

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

const severityArb = fc.constantFrom(
  ...FindingSeverityEnum.options,
);

const categoryArb = fc.constantFrom(
  ...FindingCategoryEnum.options,
);

const sourceArb = fc.constantFrom(
  ...FindingSourceEnum.options,
);

/**
 * Generates a valid Finding with random severity, category, and source.
 * Other fields are filled with plausible but arbitrary values.
 */
const findingArb: fc.Arbitrary<Finding> = fc.record({
  id: fc.uuid(),
  scanId: fc.uuid(),
  severity: severityArb,
  category: categoryArb,
  title: fc.string({ minLength: 1, maxLength: 80 }),
  file: fc.string({ minLength: 1, maxLength: 100 }),
  line: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
  standardReferences: fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
    minLength: 1,
    maxLength: 3,
  }),
  whyItMatters: fc.string({ minLength: 1, maxLength: 200 }),
  recommendation: fc.string({ minLength: 1, maxLength: 200 }),
  suggestedTests: fc.option(
    fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
      minLength: 0,
      maxLength: 3,
    }),
    { nil: undefined },
  ),
  blocking: fc.boolean(),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  source: sourceArb,
  codeSnippet: fc.option(fc.string({ minLength: 1, maxLength: 200 }), {
    nil: undefined,
  }),
});

/**
 * Generate an array of 0..20 findings.
 */
const findingsArb = fc.array(findingArb, { minLength: 0, maxLength: 20 });

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ScoringService — Property 21: Scoring output is well-formed, schema-conformant, and round-trips through persistence", () => {
  const service = new ScoringService();

  it("produces schema-conformant output for any set of findings (>=100 iterations)", () => {
    fc.assert(
      fc.property(findingsArb, (findings) => {
        const result = service.calculateScore(findings);

        // 1. Must parse against ScanScoreSchema without throwing
        const parsed = ScanScoreSchema.safeParse(result);
        expect(parsed.success).toBe(true);

        // 2. overallScore in [0, 100]
        expect(result.overallScore).toBeGreaterThanOrEqual(0);
        expect(result.overallScore).toBeLessThanOrEqual(100);

        // 3. Per-category scores in [0, 100]
        for (const key of Object.keys(result.categoryScores) as Array<
          keyof typeof result.categoryScores
        >) {
          expect(result.categoryScores[key]).toBeGreaterThanOrEqual(0);
          expect(result.categoryScores[key]).toBeLessThanOrEqual(100);
        }

        // 4. statusResult is one of the valid verdicts
        const validVerdicts = [
          "passed",
          "passed-with-warnings",
          "needs-cleanup",
          "risky",
          "blocked",
        ];
        expect(validVerdicts).toContain(result.statusResult);

        // 5. Severity counts add up correctly
        const criticalCount = findings.filter(
          (f) => f.severity === "critical",
        ).length;
        const highCount = findings.filter(
          (f) => f.severity === "high",
        ).length;
        const mediumCount = findings.filter(
          (f) => f.severity === "medium",
        ).length;
        const lowCount = findings.filter(
          (f) => f.severity === "low",
        ).length;
        const infoCount = findings.filter(
          (f) => f.severity === "info",
        ).length;

        expect(result.criticalCount).toBe(criticalCount);
        expect(result.highCount).toBe(highCount);
        expect(result.mediumCount).toBe(mediumCount);
        expect(result.lowCount).toBe(lowCount);
        expect(result.infoCount).toBe(infoCount);
        expect(result.totalFindings).toBe(findings.length);
      }),
      { numRuns: 200 },
    );
  });

  it("round-trips through JSON serialization/deserialization without data loss (>=100 iterations)", () => {
    fc.assert(
      fc.property(findingsArb, (findings) => {
        const result = service.calculateScore(findings);

        // Simulate persistence: serialize to JSON and deserialize
        const serialized = JSON.stringify(result);
        const deserialized = JSON.parse(serialized);

        // The deserialized result must still conform to schema
        const parsed = ScanScoreSchema.safeParse(deserialized);
        expect(parsed.success).toBe(true);

        // Deep equality: no data loss through the round-trip
        expect(deserialized).toEqual(result);
      }),
      { numRuns: 200 },
    );
  });
});
