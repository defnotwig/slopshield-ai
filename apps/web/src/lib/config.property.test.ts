import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Property 5: Build determinism
 *
 * With all NEXT_PUBLIC_* vars unset, config.ts imports without throwing and
 * resolves to mock mode. The config module reads process.env at import time,
 * so each property iteration resets the module registry and re-imports the
 * module under a freshly-mutated environment.
 *
 * Validates: Requirements 6.1
 */

const NEXT_PUBLIC_KEYS = [
  "NEXT_PUBLIC_API_MODE",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_APP_NAME",
] as const;

describe("config build determinism (Property 5)", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Snapshot the current values so we can restore them after each run.
    originalEnv = {};
    for (const key of NEXT_PUBLIC_KEYS) {
      originalEnv[key] = process.env[key];
    }
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
    vi.resetModules();
  });

  it("imports without throwing and resolves to mock when NEXT_PUBLIC_* vars are unset", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate which of the NEXT_PUBLIC_* vars are unset for this run.
        fc.record({
          unsetMode: fc.boolean(),
          unsetUrl: fc.boolean(),
          unsetAppName: fc.boolean(),
        }),
        async ({ unsetMode, unsetUrl, unsetAppName }) => {
          // Delete the selected vars so they are genuinely unset.
          if (unsetMode) delete process.env.NEXT_PUBLIC_API_MODE;
          if (unsetUrl) delete process.env.NEXT_PUBLIC_API_URL;
          if (unsetAppName) delete process.env.NEXT_PUBLIC_APP_NAME;

          // Re-import under the mutated environment (config reads env at import time).
          vi.resetModules();
          const mod = await import("./config");

          // Importing never throws (the dynamic import above already proves this).
          expect(mod.config).toBeDefined();

          // When the mode var is unset, the app must resolve to mock mode.
          if (unsetMode) {
            expect(mod.config.apiMode).toBe("mock");
            expect(mod.config.isMock).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolves to mock mode with every NEXT_PUBLIC_* var unset", async () => {
    for (const key of NEXT_PUBLIC_KEYS) {
      delete process.env[key];
    }

    vi.resetModules();
    const mod = await import("./config");

    expect(mod.config.apiMode).toBe("mock");
    expect(mod.config.isMock).toBe(true);
    expect(mod.config.apiUrl).toBe("");
    expect(mod.config.appName).toBe("SlopShield AI");

    // assertLiveConfig is a no-op in mock mode and must not throw.
    expect(() => mod.assertLiveConfig()).not.toThrow();
  });
});
