// Feature: github-repository-scanner, Property 8
//
// Property 8: Standards completeness.
// Validates: Requirements 6.1, 6.7
//
// For any finding (any category from FindingCategoryEnum, plus arbitrary
// category strings, with any title/description text), the StandardsMapper
// must return a NON-EMPTY array in which every element is a valid key of
// STANDARDS_REFERENCES. This guarantees that every finding always carries
// at least one valid, recognised standard reference (Requirement 6.1) and
// that a documented fallback is applied when no specific rule matches
// (Requirement 6.7).

import fc from "fast-check";
import { FindingCategoryEnum, STANDARDS_REFERENCES } from "@slopshield/shared";

import { StandardsMapper } from "./standards-mapper";

describe("StandardsMapper — Property 8: Standards completeness", () => {
  const mapper = new StandardsMapper();

  // Every value of the FindingCategory enum, plus some arbitrary strings to
  // exercise the "unknown category" path that should still hit the fallback.
  const categoryArbitrary = fc.oneof(
    fc.constantFrom(...FindingCategoryEnum.options),
    fc.string(),
  );

  it("returns a non-empty array of valid STANDARDS_REFERENCES keys for any finding", () => {
    fc.assert(
      fc.property(
        fc.string(),
        categoryArbitrary,
        fc.option(fc.string(), { nil: undefined }),
        (title, category, description) => {
          const result = mapper.mapFindingToStandards({
            title,
            category,
            description,
          });

          // Completeness: must always return at least one reference.
          expect(Array.isArray(result)).toBe(true);
          expect(result.length).toBeGreaterThanOrEqual(1);

          // Validity: every element must be a real key in STANDARDS_REFERENCES.
          for (const key of result) {
            expect(key in STANDARDS_REFERENCES).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
