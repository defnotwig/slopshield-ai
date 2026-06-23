// Feature: production-grade-system, Property 29: CORS allows an origin iff it is on the allowlist
//
// Property 29: CORS allows an origin iff it is on the allowlist.
// Validates: Requirements 10.5
//
// For any allowlist and any candidate origin, the CORS callback:
//   - allows the origin when it is in the allowlist,
//   - rejects the origin when it is NOT in the allowlist,
//   - always allows requests with no origin (same-origin / server-to-server).

import fc from "fast-check";
import { parseCorsAllowlist, buildCorsOriginCallback } from "./cors";

/**
 * Arbitrary for realistic origin strings (scheme + host + optional port).
 */
const originArb = fc.oneof(
  // Typical http/https origins with various hosts and ports
  fc.tuple(
    fc.constantFrom("http://", "https://"),
    fc.oneof(
      fc.constantFrom(
        "localhost",
        "example.com",
        "app.example.com",
        "sub.domain.example.com",
        "mysite.org",
        "api.internal.io",
      ),
      fc.domain(),
    ),
    fc.option(fc.integer({ min: 1, max: 65535 }).map((p) => `:${p}`), {
      nil: "",
    }),
  ).map(([scheme, host, port]) => `${scheme}${host}${port}`),
  // Some edge-case origins
  fc.constantFrom(
    "http://localhost:3000",
    "https://app.example.com",
    "http://192.168.1.1:8080",
    "https://evil.attacker.com",
    "http://localhost",
    "https://sub.sub.example.com:443",
  ),
);

/**
 * Arbitrary for an allowlist: 1–5 distinct origin strings.
 */
const allowlistArb = fc
  .array(originArb, { minLength: 1, maxLength: 5 })
  .map((arr) => [...new Set(arr)]); // deduplicate

/**
 * Helper: synchronously invoke the CORS callback and return the result.
 * The NestJS CORS origin callback is invoked synchronously in this implementation.
 */
function invokeCorsCallback(
  cb: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => void,
  origin: string | undefined,
): { err: Error | null; allow: boolean | undefined } {
  let result: { err: Error | null; allow: boolean | undefined } = {
    err: null,
    allow: undefined,
  };
  cb(origin, (err, allow) => {
    result = { err, allow };
  });
  return result;
}

describe("Feature: production-grade-system, Property 29: CORS allows an origin iff it is on the allowlist", () => {
  it("allows an origin iff it is on the allowlist (numRuns >= 100)", () => {
    fc.assert(
      fc.property(allowlistArb, originArb, (allowlist, candidateOrigin) => {
        const cb = buildCorsOriginCallback(allowlist);
        const isAllowed = allowlist.includes(candidateOrigin);
        const result = invokeCorsCallback(cb, candidateOrigin);

        if (isAllowed) {
          expect(result.err).toBeNull();
          expect(result.allow).toBe(true);
        } else {
          expect(result.err).toBeInstanceOf(Error);
          expect(result.allow).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("always allows requests with no origin header (same-origin / server-to-server)", () => {
    fc.assert(
      fc.property(allowlistArb, (allowlist) => {
        const cb = buildCorsOriginCallback(allowlist);
        const result = invokeCorsCallback(cb, undefined);

        expect(result.err).toBeNull();
        expect(result.allow).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("parseCorsAllowlist correctly splits and trims CORS_ORIGIN values", () => {
    fc.assert(
      fc.property(
        fc.array(originArb, { minLength: 1, maxLength: 5 }),
        (origins) => {
          // Build a comma-separated raw value with random whitespace padding
          const raw = origins.map((o) => `  ${o}  `).join(",");
          const parsed = parseCorsAllowlist(raw);

          // Every trimmed origin should be present
          for (const origin of origins) {
            expect(parsed).toContain(origin);
          }
          // No empty strings in the parsed result
          for (const entry of parsed) {
            expect(entry.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects origins that differ from allowlist entries by case, trailing slash, or extra path", () => {
    fc.assert(
      fc.property(allowlistArb, (allowlist) => {
        const cb = buildCorsOriginCallback(allowlist);

        // Construct variations that should NOT match (exact string match is required)
        const variations = allowlist.flatMap((origin) => [
          origin.toUpperCase(), // case mismatch
          `${origin}/`, // trailing slash
          `${origin}/path`, // extra path
        ]);

        for (const variant of variations) {
          // Only test variations that are truly not in the allowlist
          if (!allowlist.includes(variant)) {
            const result = invokeCorsCallback(cb, variant);
            expect(result.err).toBeInstanceOf(Error);
            expect(result.allow).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
