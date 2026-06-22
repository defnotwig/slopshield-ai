// Feature: github-repository-scanner, Property 2
//
// Property 2: Ref validation safety
// **Validates: Requirements 2.7**
//
// For any generated ref string, `validateRef` ACCEPTS it (returns the ref)
// if and only if it matches the git ref-name allowlist `^[A-Za-z0-9._/-]+$`
// AND does not contain `..` or `@{`, does not start with `-` or `/`, and does
// not end with `/` or `.lock`. Otherwise it throws
// GitHubIngestionError("invalid-ref"). Empty string / undefined returns
// undefined (use the default branch).

import fc from "fast-check";
import {
  GitHubIngestionService,
  GitHubIngestionError,
} from "./github-ingestion.service.js";

/**
 * Independent oracle for the ref-acceptance rule. Deliberately re-expresses the
 * specification (Requirement 2.7) rather than importing the service regex so a
 * regression in the service cannot silently change the expected answer too.
 */
function shouldAccept(ref: string): boolean {
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) return false;
  if (ref.includes("..")) return false;
  if (ref.includes("@{")) return false;
  if (ref.startsWith("-")) return false;
  if (ref.startsWith("/")) return false;
  if (ref.endsWith("/")) return false;
  if (ref.endsWith(".lock")) return false;
  return true;
}

const service = new GitHubIngestionService();

/** Characters that are valid members of the git ref-name allowlist. */
const VALID_REF_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/-";

/** Illegal characters / sequences the validator must reject. */
const ILLEGAL_TOKENS = [
  " ",
  "\t",
  "\n",
  "~",
  "^",
  ":",
  "?",
  "*",
  "[",
  "\\",
  "..",
  "@{",
];

describe("GitHubIngestionService.validateRef — Property 2: Ref validation safety", () => {
  it("returns undefined for empty string and undefined (default branch)", () => {
    expect(service.validateRef(undefined)).toBeUndefined();
    expect(service.validateRef("")).toBeUndefined();
  });

  it("accepts a generated ref iff it satisfies the git ref-name rules", () => {
    // Broad generator mixing valid characters with illegal tokens and the
    // adversarial leading/trailing patterns, so a single arbitrary covers both
    // the accept and reject branches of the rule.
    const refArb = fc
      .array(
        fc.oneof(
          {
            weight: 8,
            arbitrary: fc.constantFrom(...VALID_REF_CHARS.split("")),
          },
          { weight: 2, arbitrary: fc.constantFrom(...ILLEGAL_TOKENS) },
        ),
        { minLength: 1, maxLength: 30 },
      )
      .map((parts) => parts.join(""))
      // Occasionally force adversarial affixes/sequences to exercise edges.
      .chain((s) =>
        fc.constantFrom(
          s,
          `-${s}`,
          `/${s}`,
          `${s}/`,
          `${s}.lock`,
          `${s}..${s}`,
          `${s}@{0}`,
        ),
      );

    fc.assert(
      fc.property(refArb, (ref) => {
        const expected = shouldAccept(ref);
        if (expected) {
          // Accepted refs are returned unchanged.
          expect(service.validateRef(ref)).toBe(ref);
        } else {
          // Rejected refs throw an invalid-ref GitHubIngestionError and never
          // reach the fetch URL.
          let thrown: unknown;
          try {
            service.validateRef(ref);
          } catch (e) {
            thrown = e;
          }
          expect(thrown).toBeInstanceOf(GitHubIngestionError);
          expect((thrown as GitHubIngestionError).kind).toBe("invalid-ref");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("accepts well-formed refs built purely from the valid alphabet", () => {
    const validRefArb = fc
      .array(fc.constantFrom(...VALID_REF_CHARS.split("")), {
        minLength: 1,
        maxLength: 40,
      })
      .map((parts) => parts.join(""))
      // Constrain to only the strings the rule actually accepts.
      .filter((s) => shouldAccept(s));

    fc.assert(
      fc.property(validRefArb, (ref) => {
        expect(service.validateRef(ref)).toBe(ref);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects refs containing any illegal character or sequence", () => {
    const invalidRefArb = fc
      .tuple(
        fc.array(fc.constantFrom(...VALID_REF_CHARS.split("")), {
          minLength: 0,
          maxLength: 20,
        }),
        fc.constantFrom(...ILLEGAL_TOKENS),
        fc.array(fc.constantFrom(...VALID_REF_CHARS.split("")), {
          minLength: 0,
          maxLength: 20,
        }),
      )
      .map(([pre, bad, post]) => `${pre.join("")}${bad}${post.join("")}`)
      // Guard against an injected token landing in an accidentally-valid spot.
      .filter((s) => s.length > 0 && !shouldAccept(s));

    fc.assert(
      fc.property(invalidRefArb, (ref) => {
        expect(() => service.validateRef(ref)).toThrow(GitHubIngestionError);
      }),
      { numRuns: 200 },
    );
  });
});
