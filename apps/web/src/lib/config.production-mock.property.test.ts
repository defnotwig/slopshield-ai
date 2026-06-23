/**
 * Property-based test — Production refuses mock without explicit opt-in.
 *
 * Feature: production-grade-system, Property 7: Production refuses mock without explicit opt-in
 *
 * **Validates: Requirements 2.4**
 *
 * For ANY environment where NODE_ENV=production and NEXT_PUBLIC_API_MODE
 * resolves to `mock`, the config module MUST refuse Mock_Mode (isMock=false)
 * UNLESS `ALLOW_MOCK_IN_PRODUCTION` is explicitly set to an affirmative value.
 *
 * Conversely, when `ALLOW_MOCK_IN_PRODUCTION` IS set to an affirmative value
 * in production with mode `mock`, Mock_Mode is permitted (isMock=true) and
 * the mock indicator is shown.
 *
 * The config module reads `process.env` at import time, so each generated
 * environment is exercised by resetting the module registry and dynamically
 * re-importing `config`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

/** Env keys this test mutates; tracked so they can be fully restored. */
const ENV_KEYS = [
  "NEXT_PUBLIC_API_MODE",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_APP_NAME",
  "ALLOW_MOCK_IN_PRODUCTION",
  "NODE_ENV",
] as const;

/** Spellings of NEXT_PUBLIC_API_MODE that resolve to mock mode (not "live"). */
const MOCK_SPELLINGS = [
  "mock",
  "MOCK",
  "Mock",
  "mOcK",
  " mock ",
  "",
  "anything",
  "banana",
  "test",
  "demo",
];

/** Values of ALLOW_MOCK_IN_PRODUCTION that do NOT constitute an explicit opt-in. */
const NON_OPTIN_VALUES = [
  undefined, // not set at all
  "",
  "false",
  "False",
  "FALSE",
  "0",
  "no",
  "No",
  "NO",
  "off",
  "OFF",
  "nope",
  "maybe",
  "null",
  "undefined",
];

/** Values of ALLOW_MOCK_IN_PRODUCTION that ARE explicit affirmative opt-in. */
const OPTIN_VALUES = ["true", "True", "TRUE", "1", "yes", "Yes", "YES", "on", "On", "ON"];

describe("Property 7: Production refuses mock without explicit opt-in", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  });

  afterEach(() => {
    const env = process.env as Record<string, string | undefined>;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete env[key];
      else env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("refuses mock in production when ALLOW_MOCK_IN_PRODUCTION is not explicitly set to an affirmative value", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...MOCK_SPELLINGS),
        fc.constantFrom(...NON_OPTIN_VALUES),
        fc.constantFrom("", "https://api.example.com"),
        async (modeRaw, allowMock, apiUrl) => {
          // --- Arrange: production + mock mode + no opt-in ---
          const env = process.env as Record<string, string | undefined>;
          env.NODE_ENV = "production";
          env.NEXT_PUBLIC_API_MODE = modeRaw;
          env.NEXT_PUBLIC_API_URL = apiUrl;
          if (allowMock === undefined) delete env.ALLOW_MOCK_IN_PRODUCTION;
          else env.ALLOW_MOCK_IN_PRODUCTION = allowMock;

          vi.resetModules();
          const { config } = await import("./config");

          // --- Invariant: mock is refused in production without opt-in ---
          expect(config.isMock).toBe(false);
          expect(config.showMockIndicator).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("permits mock in production when ALLOW_MOCK_IN_PRODUCTION is explicitly set to an affirmative value", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...MOCK_SPELLINGS),
        fc.constantFrom(...OPTIN_VALUES),
        fc.constantFrom("", "https://api.example.com"),
        async (modeRaw, allowMock, apiUrl) => {
          // --- Arrange: production + mock mode + explicit opt-in ---
          const env = process.env as Record<string, string | undefined>;
          env.NODE_ENV = "production";
          env.NEXT_PUBLIC_API_MODE = modeRaw;
          env.NEXT_PUBLIC_API_URL = apiUrl;
          env.ALLOW_MOCK_IN_PRODUCTION = allowMock;

          vi.resetModules();
          const { config } = await import("./config");

          // --- Invariant: mock is allowed with explicit opt-in AND indicator shows ---
          expect(config.isMock).toBe(true);
          expect(config.showMockIndicator).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
