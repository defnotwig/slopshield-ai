import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isSyntheticEmail } from "./user-utils";

/**
 * **Validates: Requirements 1.1, 2.1**
 *
 * Property 1: Synthetic email detection is consistent with the regex pattern.
 * For any string `email`, `isSyntheticEmail(email)` returns `true` iff the email
 * is null, undefined, empty, or matches `/@slopshield\.local$/`.
 */
describe("isSyntheticEmail", () => {
  const SYNTHETIC_REGEX = /@slopshield\.local$/;

  describe("Property: synthetic email detection is consistent with the regex pattern", () => {
    it("returns true for any string matching /@slopshield\\.local$/", () => {
      fc.assert(
        fc.property(
          fc.string().map((prefix) => `${prefix}@slopshield.local`),
          (email) => {
            expect(isSyntheticEmail(email)).toBe(true);
          },
        ),
      );
    });

    it("returns false for any non-empty string NOT matching /@slopshield\\.local$/", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter(
            (s) => !SYNTHETIC_REGEX.test(s),
          ),
          (email) => {
            expect(isSyntheticEmail(email)).toBe(false);
          },
        ),
      );
    });

    it("for any arbitrary string, result equals null/undefined/empty OR regex match", () => {
      fc.assert(
        fc.property(fc.string(), (email) => {
          const expected = email === "" || SYNTHETIC_REGEX.test(email);
          expect(isSyntheticEmail(email)).toBe(expected);
        }),
      );
    });
  });

  describe("Example-based tests", () => {
    it("returns true for null", () => {
      expect(isSyntheticEmail(null)).toBe(true);
    });

    it("returns true for undefined", () => {
      expect(isSyntheticEmail(undefined)).toBe(true);
    });

    it("returns true for empty string", () => {
      expect(isSyntheticEmail("")).toBe(true);
    });

    it("returns true for synthetic lark email", () => {
      expect(isSyntheticEmail("lark_abc@slopshield.local")).toBe(true);
    });

    it("returns false for real gmail address", () => {
      expect(isSyntheticEmail("user@gmail.com")).toBe(false);
    });

    it("returns false for real example.com address", () => {
      expect(isSyntheticEmail("test@example.com")).toBe(false);
    });
  });
});
