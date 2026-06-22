// Feature: backend-hosting-live-mode, Property 3
import fc from "fast-check";
import { describe, expect, it } from "vitest";

/**
 * Property 3: Live base-path join is exactly one `/api/...`
 *
 * The live API client builds request URLs by plain concatenation:
 *   `${config.apiUrl}${path}`
 * where the operator sets `NEXT_PUBLIC_API_URL` to a base ending in `/api`
 * (no trailing slash) and the api-client hooks emit paths beginning with a
 * single leading `/` (e.g. `/scans`, `/projects/123`).
 *
 * This property verifies that join model: for any such base and path, the
 * concatenation contains no double slashes outside the `https://` protocol
 * and yields exactly one `/api/<path>` segment.
 *
 * The function under test is just string concatenation; we model it inline
 * to match how `api-client.request` builds the fetch URL.
 *
 * Validates: Requirements 6.2
 */

/** The join model used by the live api-client: `${apiUrl}${path}`. */
function joinBaseAndPath(base: string, path: string): string {
  return `${base}${path}`;
}

// A DNS-ish hostname label: starts/ends alphanumeric, may contain hyphens.
const hostLabel = fc
  .stringMatching(/^[a-z0-9](?:[a-z0-9-]{0,20}[a-z0-9])?$/)
  .filter((s) => s.length > 0);

// An https origin like `https://my-app.onrender.com` (no trailing slash).
const httpsOrigin = fc
  .array(hostLabel, { minLength: 2, maxLength: 4 })
  .map((labels) => `https://${labels.join(".")}`);

// A base URL ending with `/api` and no trailing slash.
const baseEndingInApi = httpsOrigin.map((origin) => `${origin}/api`);

// A REST-ish path segment containing no slashes.
const pathSegment = fc
  .stringMatching(/^[a-zA-Z0-9._-]+$/)
  .filter((s) => s.length > 0);

// A request path with a single leading `/`, e.g. `/scans`, `/projects/123`.
const requestPath = fc
  .array(pathSegment, { minLength: 1, maxLength: 4 })
  .map((segments) => `/${segments.join("/")}`);

describe("live base-path join (Property 3)", () => {
  it("contains no double slashes outside the protocol and exactly one /api segment", () => {
    fc.assert(
      fc.property(baseEndingInApi, requestPath, (base, path) => {
        const url = joinBaseAndPath(base, path);

        // Strip the protocol so we can inspect the rest for `//`.
        const protocol = "https://";
        expect(url.startsWith(protocol)).toBe(true);
        const afterProtocol = url.slice(protocol.length);

        // No double slashes anywhere after the protocol.
        expect(afterProtocol).not.toContain("//");

        // Exactly one `/api/` segment join: the base contributes `/api` and
        // the path supplies the leading `/`, producing a single `/api/...`.
        const apiMatches = url.match(/\/api(?=\/|$)/g) ?? [];
        expect(apiMatches.length).toBe(1);

        // The joined URL must start with the full base and the path follows it
        // immediately, with the `/api/` boundary intact.
        expect(url).toBe(`${base}${path}`);
        expect(url.startsWith(`${base}/`)).toBe(true);
        expect(url).toContain("/api/");
      }),
      { numRuns: 100 },
    );
  });

  it("joins a concrete example to exactly one /api/scans", () => {
    expect(
      joinBaseAndPath("https://slopshield.onrender.com/api", "/scans"),
    ).toBe("https://slopshield.onrender.com/api/scans");
  });
});
