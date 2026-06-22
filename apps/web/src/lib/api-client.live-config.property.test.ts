import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Property 4: Live config safety
 *
 * When apiMode === "live" and apiUrl === "", the first request throws a
 * descriptive error and never calls fetch with a malformed URL.
 *
 * The config module reads process.env at import time, and api-client
 * transitively imports config. So to force live + empty-url config, we set
 * NEXT_PUBLIC_API_MODE="live", clear NEXT_PUBLIC_API_URL, reset the module
 * registry, then dynamically import the api-client under that environment.
 *
 * Validates: Requirements 5.1
 */

const NEXT_PUBLIC_KEYS = [
  "NEXT_PUBLIC_API_MODE",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_APP_NAME",
] as const;

type Method = "get" | "post" | "patch" | "delete";
const METHODS: Method[] = ["get", "post", "patch", "delete"];

describe("api-client live config safety (Property 4)", () => {
  let originalEnv: Record<string, string | undefined>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Snapshot env so each run can be restored afterward.
    originalEnv = {};
    for (const key of NEXT_PUBLIC_KEYS) {
      originalEnv[key] = process.env[key];
    }

    // Spy on the global fetch. If the client ever calls it under a malformed
    // (empty base URL) live config, the property fails.
    fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    for (const key of NEXT_PUBLIC_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("throws a descriptive error and never calls fetch under live + empty url", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...METHODS),
        fc.string(),
        async (method, rawPath) => {
          // Force live mode with an empty/absent API URL for this run.
          process.env.NEXT_PUBLIC_API_MODE = "live";
          delete process.env.NEXT_PUBLIC_API_URL;
          fetchSpy.mockClear();

          // Re-import the client under the mutated environment (config + client
          // read env at import time).
          vi.resetModules();
          const { apiClient } = await import("./api-client");

          // Ensure the path looks like a REST path the hooks would emit.
          const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

          // The call must reject, and fetch must never have been invoked.
          await expect(apiClient[method](path)).rejects.toThrow();
          expect(fetchSpy).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  }, 15000);

  it("throws an error message mentioning NEXT_PUBLIC_API_URL", async () => {
    process.env.NEXT_PUBLIC_API_MODE = "live";
    delete process.env.NEXT_PUBLIC_API_URL;
    fetchSpy.mockClear();

    vi.resetModules();
    const { apiClient } = await import("./api-client");

    await expect(apiClient.get("/scans")).rejects.toThrow(
      /NEXT_PUBLIC_API_URL/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
