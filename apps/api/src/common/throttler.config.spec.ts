import fc from "fast-check";
import {
  THROTTLER_NAMES,
  buildThrottlerOptions,
  resolveDefaultThrottle,
  resolveLoginThrottle,
  resolveScanThrottle,
} from "./throttler.config.js";

describe("throttler.config", () => {
  describe("defaults", () => {
    it("applies documented defaults when no env overrides are set", () => {
      const env = {} as NodeJS.ProcessEnv;
      expect(resolveDefaultThrottle(env)).toEqual({ ttl: 60_000, limit: 100 });
      expect(resolveLoginThrottle(env)).toEqual({ ttl: 60_000, limit: 5 });
      expect(resolveScanThrottle(env)).toEqual({ ttl: 60_000, limit: 10 });
    });

    it("login and scan limits are tighter than the global default", () => {
      const env = {} as NodeJS.ProcessEnv;
      expect(resolveLoginThrottle(env).limit).toBeLessThan(
        resolveDefaultThrottle(env).limit,
      );
      expect(resolveScanThrottle(env).limit).toBeLessThan(
        resolveDefaultThrottle(env).limit,
      );
    });
  });

  describe("env overrides", () => {
    it("reads positive integer overrides", () => {
      const env = {
        RATE_LIMIT_DEFAULT: "200",
        RATE_LIMIT_TTL_MS: "30000",
        RATE_LIMIT_LOGIN: "3",
        RATE_LIMIT_LOGIN_TTL_MS: "120000",
        RATE_LIMIT_SCAN: "7",
        RATE_LIMIT_SCAN_TTL_MS: "90000",
      } as unknown as NodeJS.ProcessEnv;
      expect(resolveDefaultThrottle(env)).toEqual({ ttl: 30_000, limit: 200 });
      expect(resolveLoginThrottle(env)).toEqual({ ttl: 120_000, limit: 3 });
      expect(resolveScanThrottle(env)).toEqual({ ttl: 90_000, limit: 7 });
    });

    it("falls back to defaults for blank, zero, negative, or non-numeric values", () => {
      const env = {
        RATE_LIMIT_DEFAULT: "",
        RATE_LIMIT_LOGIN: "0",
        RATE_LIMIT_SCAN: "-5",
        RATE_LIMIT_TTL_MS: "notanumber",
      } as unknown as NodeJS.ProcessEnv;
      expect(resolveDefaultThrottle(env)).toEqual({ ttl: 60_000, limit: 100 });
      expect(resolveLoginThrottle(env).limit).toBe(5);
      expect(resolveScanThrottle(env).limit).toBe(10);
    });
  });

  describe("buildThrottlerOptions", () => {
    it("registers only the global default throttler", () => {
      const options = buildThrottlerOptions({} as NodeJS.ProcessEnv);
      expect(options).toHaveLength(1);
      expect(options[0].name).toBe(THROTTLER_NAMES.default);
      expect(options[0]).toMatchObject({ ttl: 60_000, limit: 100 });
    });
  });

  describe("property: resolvers always yield positive ttl and limit", () => {
    it("never returns a non-positive ttl or limit for arbitrary string env", () => {
      fc.assert(
        fc.property(
          fc.option(fc.string(), { nil: undefined }),
          fc.option(fc.string(), { nil: undefined }),
          (limitRaw, ttlRaw) => {
            const env = {
              RATE_LIMIT_DEFAULT: limitRaw,
              RATE_LIMIT_TTL_MS: ttlRaw,
            } as unknown as NodeJS.ProcessEnv;
            const rule = resolveDefaultThrottle(env);
            expect(rule.ttl).toBeGreaterThan(0);
            expect(rule.limit).toBeGreaterThan(0);
          },
        ),
      );
    });
  });
});
