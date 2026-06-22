/**
 * Property-based tests for the mock path resolver.
 *
 * Property 2: Hook surface stability
 * Every REST path the existing hooks emit
 * (`/scans`, `/scans/:id`, `/scans/:id/findings`, `/dashboard/summary`,
 * `/dashboard/trends`, `/dashboard/top-issues`, `/dashboard/standards`,
 * `/projects`, `/projects/:id`, `/rules`, `/auth/me`, `/users/notifications`)
 * resolves to a defined mock payload — no `404` on the happy path. Conversely,
 * any GET path that matches no route throws `ApiError(404, ...)`.
 *
 * Two complementary properties are exercised:
 *  1. Happy path — arbitrary path drawn from the known hook-path set resolves
 *     to a defined (non-undefined, non-null) payload and never throws.
 *  2. Unmatched GET — arbitrary pathnames that match no route always throw an
 *     `ApiError` with `statusCode === 404`.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveMock } from "./mock-resolver";
import { ApiError } from "./api-client";
import { mockScanJobs, mockProjects } from "./mock-data";

// Substitute real mock ids for `:id` params so the happy-path requests resolve
// to concrete records rather than 404-ing on a missing resource.
const SCAN_ID = mockScanJobs[0].id;
const PROJECT_ID = mockProjects[0].id;

/** The complete set of REST paths the existing hooks emit (happy path). */
const HAPPY_PATHS: readonly string[] = [
  "/scans",
  `/scans/${SCAN_ID}`,
  `/scans/${SCAN_ID}/findings`,
  "/dashboard/summary",
  "/dashboard/trends",
  "/dashboard/top-issues",
  "/dashboard/standards",
  "/projects",
  `/projects/${PROJECT_ID}`,
  "/rules",
  "/auth/me",
  "/users/notifications",
];

describe("Property 2: Hook surface stability (mock-resolver)", () => {
  // **Validates: Requirements 3.2**
  it("every known hook path resolves to a defined payload and never 404s", () => {
    fc.assert(
      fc.property(fc.constantFrom(...HAPPY_PATHS), (path) => {
        const payload = resolveMock("GET", path);
        // Must not throw, and must produce a defined, non-null payload.
        expect(payload).toBeDefined();
        expect(payload).not.toBeNull();
      }),
    );
  });

  // **Validates: Requirements 3.3**
  it("any unmatched GET path throws ApiError with statusCode 404", () => {
    fc.assert(
      fc.property(
        // Generate arbitrary segments that cannot collide with a real route.
        fc.array(
          fc
            .string({ minLength: 1, maxLength: 12 })
            // Exclude path separators / query markers so each piece stays a
            // single, non-empty path segment under the "/unknown" prefix.
            .filter((s) => !/[/?#]/.test(s)),
          { minLength: 1, maxLength: 4 },
        ),
        (segments) => {
          const path = `/unknown/${segments.join("/")}`;
          let thrown: unknown;
          try {
            resolveMock("GET", path);
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(ApiError);
          expect((thrown as ApiError).statusCode).toBe(404);
        },
      ),
    );
  });
});
