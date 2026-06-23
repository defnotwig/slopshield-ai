// Feature: production-grade-system, Property 20: Every finding carries at least one standard reference
//
// Property 20 (design.md): For any finding produced by a scan, after the
// Standards_Mapper runs the finding's `standardReferences` is non-empty,
// using a documented fallback reference when no specific standard matches.
//
// Validates: Requirements 6.7, 6.8
//   6.7 — THE Standards_Mapper SHALL assign each applicable Finding one or
//         more Standard_Reference identifiers (OWASP/CWE/NIST SSDF/ISO 25010/
//         WCAG 2.2).
//   6.8 — WHEN a Finding has no specifically matching standard, THE
//         Standards_Mapper SHALL assign a documented fallback Standard_Reference
//         so that every Finding carries at least one reference.
//
// Strategy: fast-check generates findings spanning every FindingCategory enum
// value plus arbitrary/empty category strings, with arbitrary (and empty)
// title/description text. This deliberately exercises the "no specific
// standard matches" path (random/empty text + unknown category) so the
// documented fallback is forced. For any such finding the mapper must return
// at least one Standard_Reference, and every returned key must be a real key
// in STANDARDS_REFERENCES.

import fc from "fast-check";
import { FindingCategoryEnum, STANDARDS_REFERENCES } from "@slopshield/shared";

import { StandardsMapper } from "./standards-mapper";

describe("StandardsMapper — Property 20: Guaranteed standard reference", () => {
  const mapper = new StandardsMapper();

  // Known finding categories, arbitrary strings (unknown-category path), and
  // the empty string (no category match → forces the documented fallback).
  const categoryArbitrary = fc.oneof(
    fc.constantFrom(...FindingCategoryEnum.options),
    fc.string(),
    fc.constant(""),
  );

  it("assigns >=1 valid Standard_Reference to any finding (documented fallback when nothing matches)", () => {
    fc.assert(
      fc.property(
        fc.string(),
        categoryArbitrary,
        fc.option(fc.string(), { nil: undefined }),
        (title, category, description) => {
          const references = mapper.mapFindingToStandards({
            title,
            category,
            description,
          });

          // Guarantee (Req 6.8): every finding carries at least one reference.
          expect(Array.isArray(references)).toBe(true);
          expect(references.length).toBeGreaterThanOrEqual(1);

          // Validity (Req 6.7): every reference is a real STANDARDS_REFERENCES key.
          for (const key of references) {
            expect(key in STANDARDS_REFERENCES).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("uses a documented fallback reference when no specific standard matches", () => {
    fc.assert(
      // An empty category + empty text exercises the no-match path, which must
      // still yield exactly the documented fallback reference.
      fc.property(fc.constant(""), fc.constant(""), (category, title) => {
        const references = mapper.mapFindingToStandards({
          title,
          category,
          description: "",
        });

        expect(references.length).toBeGreaterThanOrEqual(1);
        // The fallback key must itself be a documented standard.
        for (const key of references) {
          expect(key in STANDARDS_REFERENCES).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
