// Feature: production-grade-system, Property 11: Git ref allowlist
//
// Property 11: Git ref allowlist
// **Validates: Requirements 4.3, 4.11**
//
// For any candidate ref, the GitHub_Ingestion_Service accepts it (returns the
// ref) if and only if it matches the git ref-name character allowlist
// (`^[A-Za-z0-9._/-]+$`) and contains none of the forbidden sequences:
//   - `..`
//   - `@{`
//   - a leading `-`
//   - a leading `/`
//   - a trailing `/`
//   - a trailing `.lock`
// Otherwise it is rejected with a GitHubIngestionError("invalid-ref"),
// preventing injection through the ref. Empty string / undefined returns
// undefined (use the default branch — Requirement 4.3 absent ref).

import "reflect-metadata";
import fc from "fast-check";
import {
  GitHubIngestionService,
  GitHubIngestionError,
} from "./github-ingestion.service";

/**
 * Independent oracle for the ref-acceptance rule. Deliberately re-expresses the
 * specification (Requirements 4.3, 4.11) rather than importing the service's
 * own regex, so a regression in the service cannot silently change the expected
 * answer in lock-step with the test.
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

/**
 * Illegal characters and sequences the validator must reject. Includes the
 * shell/SSRF-relevant metacharacters (Requirement 4.11) plus the git-specific
 * forbidden sequences (Requirement 4.3).
 */
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
  "$",
  "`",
  ";",
  "&",
  "|",
  "..",
  "@{",
];

describe("GitHubIngestionService.validateRef — Property 11: Git ref allowlist", () => {
  it("returns undefined for empty string and undefined (default branch)", () => {
    expect(service.validateRef(undefined)).toBeUndefined();
    expect(service.validateRef("")).toBeUndefined();
  });

  it("accepts a candidate ref iff it matches the allowlist and has no forbidden sequence", () => {
    // Broad generator mixing valid characters with illegal tokens and the
    // adversarial leading/trailing affixes, so a single arbitrary exercises
    // both the accept and reject branches of the rule.
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
          // reach the fetch URL — closing the injection vector.
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
      .filter((s) => shouldAccept(s));

    fc.assert(
      fc.property(validRefArb, (ref) => {
        expect(service.validateRef(ref)).toBe(ref);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects injection-like refs containing any illegal character or sequence", () => {
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
        let thrown: unknown;
        try {
          service.validateRef(ref);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(GitHubIngestionError);
        expect((thrown as GitHubIngestionError).kind).toBe("invalid-ref");
      }),
      { numRuns: 200 },
    );
  });
});
