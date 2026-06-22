/**
 * Property-based tests for the mock-data module.
 *
 * Property 3: Schema validity
 * All shared-typed mock literals validate against their `@slopshield/shared`
 * Zod schemas (`ScanJobSchema`, `FindingSchema`, `ScanScoreSchema`,
 * `LarkScanSummarySchema`, `RuleSchema`).
 *
 * Strategy: for each shared-typed literal collection, use fast-check to pick an
 * arbitrary element (via `fc.constantFrom` over the array / record values) and
 * assert that the corresponding schema's `safeParse` succeeds. Driving the
 * assertion with fast-check ensures every element in each collection is a valid
 * target for the property across the generated runs.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ScanJobSchema,
  FindingSchema,
  ScanScoreSchema,
  LarkScanSummarySchema,
  RuleSchema,
} from "@slopshield/shared";
import {
  mockScanJobs,
  mockFindingsByScanId,
  mockScanScoreByScanId,
  mockLarkCardPreview,
  mockRules,
} from "./mock-data";

/**
 * Helper: assert a Zod schema accepts an arbitrary element drawn from a
 * non-empty collection. Fails loudly (with the offending element) when the
 * schema rejects.
 */
function assertAllValid<T>(
  elements: readonly T[],
  parse: (value: T) => { success: boolean; error?: unknown },
): void {
  expect(elements.length).toBeGreaterThan(0);
  fc.assert(
    fc.property(fc.constantFrom(...elements), (element) => {
      const result = parse(element);
      if (!result.success) {
        // Surface the schema error to make counterexamples actionable.
        throw new Error(
          `Schema validation failed for element:\n${JSON.stringify(
            element,
            null,
            2,
          )}\nError: ${JSON.stringify(result.error, null, 2)}`,
        );
      }
      return result.success;
    }),
  );
}

describe("Property 3: Schema validity (mock-data)", () => {
  // **Validates: Requirements 4.1**
  it("every mock scan job parses against ScanJobSchema", () => {
    assertAllValid(mockScanJobs, (job) => ScanJobSchema.safeParse(job));
  });

  // **Validates: Requirements 4.1**
  it("every mock finding (flattened across scan ids) parses against FindingSchema", () => {
    const allFindings = Object.values(mockFindingsByScanId).flat();
    assertAllValid(allFindings, (finding) => FindingSchema.safeParse(finding));
  });

  // **Validates: Requirements 4.1**
  it("every mock scan score parses against ScanScoreSchema", () => {
    const allScores = Object.values(mockScanScoreByScanId);
    assertAllValid(allScores, (score) => ScanScoreSchema.safeParse(score));
  });

  // **Validates: Requirements 4.1**
  it("the mock Lark card preview parses against LarkScanSummarySchema", () => {
    assertAllValid([mockLarkCardPreview], (summary) =>
      LarkScanSummarySchema.safeParse(summary),
    );
  });

  // **Validates: Requirements 4.1**
  it("every mock rule parses against RuleSchema", () => {
    assertAllValid(mockRules, (rule) => RuleSchema.safeParse(rule));
  });
});
