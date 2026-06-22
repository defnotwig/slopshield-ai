// Feature: backend-hosting-live-mode, Property 1: Port precedence
//
// Property 1: Port precedence.
// Validates: Requirements 2.1, 2.2, 2.3
//
// For any environment, resolvePort(env) returns:
//   - the numeric value of PORT when PORT is a valid positive integer; else
//   - the numeric value of API_PORT when API_PORT is a valid positive integer; else
//   - 3001.
//
// "Valid positive integer" mirrors the implementation's parse rule: the value
// is run through parseInt(value, 10) and accepted when the result is a finite
// number greater than 0.

import fc from "fast-check";
import { resolvePort } from "./env";

/**
 * Independent oracle that mirrors the documented precedence rule without
 * re-using the production implementation. A raw string is "valid" when
 * parseInt(raw, 10) yields a finite, strictly-positive number.
 */
function parsePositive(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function expectedPort(env: { PORT?: string; API_PORT?: string }): number {
  return parsePositive(env.PORT) ?? parsePositive(env.API_PORT) ?? 3001;
}

/**
 * Generators covering numeric, empty, non-numeric, and absent values for each
 * variable. fc.option(..., { nil: undefined }) models the "absent" case so the
 * key is omitted from the constructed env.
 */
const portValueArb = fc.option(
  fc.oneof(
    // Valid positive integers as strings.
    fc.integer({ min: 1, max: 65_535 }).map(String),
    // Zero and negatives — numeric but not positive.
    fc.integer({ min: -65_535, max: 0 }).map(String),
    // Empty string.
    fc.constant(""),
    // Non-numeric / junk strings.
    fc.string(),
    // Mixed leading-number strings (e.g. "80abc" -> parseInt 80).
    fc.constantFrom("80abc", "  3000", "1e3", "0x10", "NaN", "   "),
  ),
  { nil: undefined },
);

const envArb = fc.record({
  PORT: portValueArb,
  API_PORT: portValueArb,
});

function buildEnv(spec: {
  PORT?: string;
  API_PORT?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (spec.PORT !== undefined) env.PORT = spec.PORT;
  if (spec.API_PORT !== undefined) env.API_PORT = spec.API_PORT;
  return env;
}

describe("resolvePort — Property 1: Port precedence", () => {
  it("returns valid PORT, else valid API_PORT, else 3001", () => {
    fc.assert(
      fc.property(envArb, (spec) => {
        expect(resolvePort(buildEnv(spec))).toBe(expectedPort(spec));
      }),
      { numRuns: 1000 },
    );
  });

  it("prefers a valid PORT over a valid API_PORT", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65_535 }),
        fc.integer({ min: 1, max: 65_535 }),
        (port, apiPort) => {
          const resolved = resolvePort({
            PORT: String(port),
            API_PORT: String(apiPort),
          });
          expect(resolved).toBe(port);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("falls back to API_PORT when PORT is absent or invalid", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<string | undefined>(undefined, "", "abc", "0", "-5"),
        fc.integer({ min: 1, max: 65_535 }),
        (badPort, apiPort) => {
          const env: NodeJS.ProcessEnv = { API_PORT: String(apiPort) };
          if (badPort !== undefined) env.PORT = badPort;
          expect(resolvePort(env)).toBe(apiPort);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Explicit edge cases for the documented precedence (Requirements 2.1–2.3).
  it.each([
    [{ PORT: "8080", API_PORT: "9090" }, 8080],
    [{ PORT: "8080" }, 8080],
    [{ API_PORT: "9090" }, 9090],
    [{ PORT: "", API_PORT: "9090" }, 9090],
    [{ PORT: "notaport", API_PORT: "9090" }, 9090],
    [{ PORT: "0", API_PORT: "9090" }, 9090],
    [{ PORT: "-1", API_PORT: "9090" }, 9090],
    [{}, 3001],
    [{ PORT: "" }, 3001],
    [{ API_PORT: "abc" }, 3001],
    [{ PORT: "abc", API_PORT: "def" }, 3001],
  ] as [{ PORT?: string; API_PORT?: string }, number][])(
    "env %o resolves to %i",
    (spec, expected) => {
      expect(resolvePort(buildEnv(spec))).toBe(expected);
    },
  );
});
