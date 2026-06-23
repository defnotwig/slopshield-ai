/**
 * Property-based test — Live mode forces real data only.
 *
 * Feature: production-grade-system, Property 6: Live mode forces real data only
 *
 * **Validates: Requirements 2.1, 2.2**
 *
 * For ANY combination of environment configuration in which
 * `NEXT_PUBLIC_API_MODE` resolves to `live`, two invariants must hold:
 *   1. `config.isMock` resolves to `false` (Req 2.1, 2.2a).
 *   2. The mock resolver is never invoked for any API method or path — every
 *      request goes through the real network (`fetch`) path instead (Req 2.2).
 *
 * The config module reads `process.env` at import time, so each generated
 * environment is exercised by resetting the module registry and dynamically
 * re-importing `config`, `mock-resolver`, and `api-client` together. The mock
 * resolver is spied on so any invocation in live mode fails the property; the
 * network `fetch` is stubbed so live requests resolve without real I/O.
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

/** Raw `NEXT_PUBLIC_API_MODE` spellings that all resolve to live mode. */
const LIVE_SPELLINGS = ["live", "LIVE", "Live", "lIvE", " live ", "  LIVE  ", "live\t"];

/** Non-empty API URLs so `assertLiveConfig` does not throw in live mode. */
const API_URLS = [
  "https://api.example.com",
  "https://slopshield.test",
  "http://localhost:3001",
  "https://api.slopshield.io/api",
];

/** REST methods and paths the app's hooks emit. */
const METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
const PATHS = [
  "/scans",
  "/scans/abc-123",
  "/scans/abc-123/findings",
  "/dashboard/summary",
  "/dashboard/trends",
  "/projects",
  "/auth/me",
  "/users/notifications",
  "/unmodeled/route",
];

describe("Property 6: Live mode forces real data only", () => {
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("isMock is false and the mock resolver is never invoked for any live-mode env or request", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...LIVE_SPELLINGS),
        fc.constantFrom(...API_URLS),
        // Other flags must not be able to re-enable mock mode under live.
        fc.constantFrom(undefined, "true", "1", "false", "0", ""),
        fc.constantFrom(undefined, "production", "development", "test"),
        fc.constantFrom(...METHODS),
        fc.constantFrom(...PATHS),
        async (modeRaw, apiUrl, allowMock, nodeEnv, method, path) => {
          // --- Arrange: install the generated environment ---
          const env = process.env as Record<string, string | undefined>;
          env.NEXT_PUBLIC_API_MODE = modeRaw;
          env.NEXT_PUBLIC_API_URL = apiUrl;
          if (allowMock === undefined) delete env.ALLOW_MOCK_IN_PRODUCTION;
          else env.ALLOW_MOCK_IN_PRODUCTION = allowMock;
          if (nodeEnv === undefined) delete env.NODE_ENV;
          else env.NODE_ENV = nodeEnv;

          vi.resetModules();

          // Stub the network so live requests resolve without real I/O.
          const fetchSpy = vi.fn(async () => ({
            status: 200,
            ok: true,
            json: async () => ({ ok: true }),
          }));
          vi.stubGlobal("fetch", fetchSpy);

          // Import the resolver first and spy on it, then import the client so
          // the client's named import resolves to the spied namespace export.
          const resolverMod = await import("./mock-resolver");
          const resolveMockSpy = vi.spyOn(resolverMod, "resolveMock");

          const { config } = await import("./config");
          const { apiClient } = await import("./api-client");

          // --- Invariant 1: live mode never reports mock ---
          expect(config.apiMode).toBe("live");
          expect(config.isMock).toBe(false);

          // --- Act: issue a request through the public client surface ---
          const call =
            method === "GET"
              ? apiClient.get(path)
              : method === "POST"
                ? apiClient.post(path, { sample: true })
                : method === "PATCH"
                  ? apiClient.patch(path, { sample: true })
                  : apiClient.delete(path);
          await call;

          // --- Invariant 2: the mock resolver is never invoked; the real
          // network path (fetch) is used instead ---
          expect(resolveMockSpy).not.toHaveBeenCalled();
          expect(fetchSpy).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
