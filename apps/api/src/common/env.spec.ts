// Property tests for the pure environment helpers in `./env`.
//
// This file is shared by the env-helper property tests. Each describe block is
// tagged with its feature/property so tasks can append independently without
// overwriting one another.

import fc from "fast-check";
import {
  capFiles,
  findMissingEnv,
  findRefreshSecretIssue,
  computeReadiness,
  formatIntegrationSummary,
} from "./env";

// Feature: backend-hosting-live-mode, Property 6
//
// Property 6: Missing-required-env detection in production.
// Validates: Requirements 12.1
//
// For any environment with NODE_ENV === "production", findMissingEnv(env)
// returns exactly the set of required variables that are absent or blank (and
// an empty list when all are present); for any non-production environment it
// returns an empty list.
describe("findMissingEnv — Property 6: Missing-required-env detection in production", () => {
  const REQUIRED = [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "CORS_ORIGIN",
  ] as const;

  // A present value: any string that is non-blank after trimming.
  const presentValue = fc.string().filter((s) => s.trim() !== "");

  // A "missing" representation: the key is either absent, empty, or blank
  // (whitespace only). `undefined` models an absent key.
  const blankValue = fc.constantFrom(undefined, "", " ", "   ", "\t", "\n");

  // Build an env object by choosing, per required key, whether it is present
  // (with a non-blank value) or missing (absent/blank). Returns the env plus
  // the oracle set of keys that should be reported missing.
  const prodEnvArb = fc
    .record({
      DATABASE_URL: fc.oneof(presentValue, blankValue),
      REDIS_URL: fc.oneof(presentValue, blankValue),
      JWT_SECRET: fc.oneof(presentValue, blankValue),
      CORS_ORIGIN: fc.oneof(presentValue, blankValue),
    })
    .map((chosen) => {
      const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
      const expectedMissing: string[] = [];
      for (const key of REQUIRED) {
        const value = chosen[key];
        if (value === undefined || value.trim() === "") {
          expectedMissing.push(key);
          // Randomly omit the key vs. set it blank — both must be treated as
          // missing. When `undefined`, leave it off the object entirely.
          if (value !== undefined) env[key] = value;
        } else {
          env[key] = value;
        }
      }
      return { env, expectedMissing };
    });

  it("in production, returns exactly the absent-or-blank required vars", () => {
    fc.assert(
      fc.property(prodEnvArb, ({ env, expectedMissing }) => {
        const result = findMissingEnv(env);
        // Order-independent set equality against the oracle.
        const byName = (a: string, b: string): number => a.localeCompare(b);
        expect([...result].sort(byName)).toEqual(
          [...expectedMissing].sort(byName),
        );
      }),
      { numRuns: 200 },
    );
  });

  it("in production with all required vars present, returns an empty list", () => {
    fc.assert(
      fc.property(
        presentValue,
        presentValue,
        presentValue,
        presentValue,
        (db, redis, jwt, cors) => {
          const env: NodeJS.ProcessEnv = {
            NODE_ENV: "production",
            DATABASE_URL: db,
            REDIS_URL: redis,
            JWT_SECRET: jwt,
            CORS_ORIGIN: cors,
          };
          expect(findMissingEnv(env)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("outside production, always returns an empty list regardless of missing vars", () => {
    // NODE_ENV that is anything other than "production" (including absent).
    const nonProdNodeEnv = fc.oneof(
      fc.constantFrom(
        undefined,
        "development",
        "test",
        "staging",
        "Production", // case-sensitive: not exactly "production"
        "prod",
        "",
      ),
      fc.string().filter((s) => s !== "production"),
    );

    fc.assert(
      fc.property(
        nonProdNodeEnv,
        fc.record(
          {
            DATABASE_URL: fc.oneof(presentValue, blankValue),
            REDIS_URL: fc.oneof(presentValue, blankValue),
            JWT_SECRET: fc.oneof(presentValue, blankValue),
            CORS_ORIGIN: fc.oneof(presentValue, blankValue),
          },
          { requiredKeys: [] },
        ),
        (nodeEnv, vars) => {
          const env: NodeJS.ProcessEnv = { ...vars };
          if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
          expect(findMissingEnv(env)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: production-grade-system, Property 32: Required-env detection is correct in production
//
// Property 32: Required-env detection is correct in production.
// Validates: Requirements 11.1, 11.2
//
// For any environment map, in a production environment `findMissingEnv`
// returns exactly the set of required variables (`DATABASE_URL`, `REDIS_URL`,
// `JWT_SECRET`, `CORS_ORIGIN`) that are absent or blank (and an empty list when
// all are present); outside production it returns an empty list regardless of
// which required variables are missing.
describe("findMissingEnv — Property 32: Required-env detection is correct in production", () => {
  const REQUIRED = [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "CORS_ORIGIN",
  ] as const;

  // A present value: any string that is non-blank after trimming.
  const presentValue = fc.string().filter((s) => s.trim() !== "");

  // A "missing" representation: the key is absent, empty, or blank
  // (whitespace only). `undefined` models an absent key.
  const blankValue = fc.constantFrom(undefined, "", " ", "   ", "\t", "\n");

  // Build a production env by choosing, per required key, whether it is present
  // (with a non-blank value) or missing (absent/blank). Returns the env plus
  // the oracle set of keys that should be reported missing.
  const prodEnvArb = fc
    .record({
      DATABASE_URL: fc.oneof(presentValue, blankValue),
      REDIS_URL: fc.oneof(presentValue, blankValue),
      JWT_SECRET: fc.oneof(presentValue, blankValue),
      CORS_ORIGIN: fc.oneof(presentValue, blankValue),
    })
    .map((chosen) => {
      const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
      const expectedMissing: string[] = [];
      for (const key of REQUIRED) {
        const value = chosen[key];
        if (value === undefined || value.trim() === "") {
          expectedMissing.push(key);
          // Absent (undefined) and blank are both "missing"; only set blank
          // values, leave absent keys off the object entirely.
          if (value !== undefined) env[key] = value;
        } else {
          env[key] = value;
        }
      }
      return { env, expectedMissing };
    });

  it("in production, reports exactly the absent-or-blank required vars", () => {
    fc.assert(
      fc.property(prodEnvArb, ({ env, expectedMissing }) => {
        const result = findMissingEnv(env);
        const byName = (a: string, b: string): number => a.localeCompare(b);
        // Order-independent set equality against the oracle.
        expect([...result].sort(byName)).toEqual(
          [...expectedMissing].sort(byName),
        );
      }),
      { numRuns: 200 },
    );
  });

  it("in production with all required vars present, reports none missing", () => {
    fc.assert(
      fc.property(
        presentValue,
        presentValue,
        presentValue,
        presentValue,
        (db, redis, jwt, cors) => {
          const env: NodeJS.ProcessEnv = {
            NODE_ENV: "production",
            DATABASE_URL: db,
            REDIS_URL: redis,
            JWT_SECRET: jwt,
            CORS_ORIGIN: cors,
          };
          expect(findMissingEnv(env)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("outside production, reports none missing regardless of absent vars", () => {
    const nonProdNodeEnv = fc.oneof(
      fc.constantFrom(
        undefined,
        "development",
        "test",
        "staging",
        "Production", // case-sensitive: not exactly "production"
        "prod",
        "",
      ),
      fc.string().filter((s) => s !== "production"),
    );

    fc.assert(
      fc.property(
        nonProdNodeEnv,
        fc.record(
          {
            DATABASE_URL: fc.oneof(presentValue, blankValue),
            REDIS_URL: fc.oneof(presentValue, blankValue),
            JWT_SECRET: fc.oneof(presentValue, blankValue),
            CORS_ORIGIN: fc.oneof(presentValue, blankValue),
          },
          { requiredKeys: [] },
        ),
        (nodeEnv, vars) => {
          const env: NodeJS.ProcessEnv = { ...vars };
          if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
          expect(findMissingEnv(env)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: backend-hosting-live-mode, Property 5
//
// Property 5: Heavy-analyzer file cap is bounded and order-preserving.
// Validates: Requirements 8.4
//
// For any list of files and any non-negative cap `n`, capFiles(files, n)
// returns at most `n` elements, all drawn from the input in their original
// order (a prefix of the input).
describe("capFiles — Property 5: bounded, order-preserving file cap", () => {
  it("returns an order-preserving prefix of at most `max` elements", () => {
    fc.assert(
      fc.property(
        fc.array(fc.anything()),
        // non-negative caps including 0 and caps larger than the array length
        fc.nat(),
        (files, max) => {
          const result = capFiles(files, max);

          // Bounded: never more than `max` elements...
          expect(result.length).toBeLessThanOrEqual(max);
          // ...and never more than the input length.
          expect(result.length).toBeLessThanOrEqual(files.length);
          // Exact length is min(max, input length).
          expect(result.length).toBe(Math.min(max, files.length));

          // Order-preserving prefix: result equals the first `result.length`
          // elements of the input, by identity.
          for (let i = 0; i < result.length; i++) {
            expect(result[i]).toBe(files[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it.each([
    [["a", "b", "c"], 0, []],
    [["a", "b", "c"], 2, ["a", "b"]],
    [["a", "b", "c"], 3, ["a", "b", "c"]],
    [["a", "b", "c"], 10, ["a", "b", "c"]], // cap > length
    [[], 5, []],
  ] as [string[], number, string[]][])(
    "capFiles(%j, %i) === %j",
    (files, max, expected) => {
      expect(capFiles(files, max)).toEqual(expected);
    },
  );
});

// Unit tests for the optional-integration readiness helpers.
//
// Validates: Requirements 11.5, 11.6, 11.7
describe("computeReadiness — optional integration readiness", () => {
  it("reports absent integrations as 'skipped' (Req 11.7)", () => {
    expect(computeReadiness({})).toEqual({
      gemini: "skipped",
      githubToken: "skipped",
      lark: "skipped",
      githubApp: "skipped",
    });
  });

  it("reports present integrations as 'configured' (Req 11.6)", () => {
    const env: NodeJS.ProcessEnv = {
      GEMINI_API_KEY: "gem",
      GITHUB_TOKEN: "ghp_x",
      LARK_WEBHOOK_URL: "https://example.com/hook",
    };
    expect(computeReadiness(env)).toEqual({
      gemini: "configured",
      githubToken: "configured",
      lark: "configured",
      githubApp: "skipped",
    });
  });

  it("treats blank/whitespace values as 'skipped'", () => {
    const env: NodeJS.ProcessEnv = {
      GEMINI_API_KEY: "",
      GITHUB_TOKEN: "   ",
      LARK_WEBHOOK_URL: "\t",
    };
    expect(computeReadiness(env)).toEqual({
      gemini: "skipped",
      githubToken: "skipped",
      lark: "skipped",
      githubApp: "skipped",
    });
  });

  it("reports each integration independently", () => {
    const env: NodeJS.ProcessEnv = { GEMINI_API_KEY: "gem" };
    expect(computeReadiness(env)).toEqual({
      gemini: "configured",
      githubToken: "skipped",
      lark: "skipped",
      githubApp: "skipped",
    });
  });

  it("never throws / hard-fails (Req 11.6)", () => {
    expect(() => computeReadiness({})).not.toThrow();
  });
});

describe("formatIntegrationSummary — one-time startup summary (Req 11.5)", () => {
  it("summarizes each integration status in a single line", () => {
    const summary = formatIntegrationSummary({
      gemini: "configured",
      githubToken: "skipped",
      lark: "error",
      githubApp: "skipped",
    });
    expect(summary).toBe(
      "Integrations: gemini=configured, githubToken=skipped, lark=error, githubApp=skipped",
    );
  });

  it("includes all integrations", () => {
    const summary = formatIntegrationSummary({
      gemini: "skipped",
      githubToken: "skipped",
      lark: "skipped",
      githubApp: "skipped",
    });
    expect(summary).toContain("gemini=");
    expect(summary).toContain("githubToken=");
    expect(summary).toContain("lark=");
    expect(summary).toContain("githubApp=");
  });
});

// Feature: production-grade-system, Property 33: Refresh secret must be present and distinct in production
//
// Validates: Requirements 11.3
//
// For any production environment, refresh-secret validation FAILS when
// REFRESH_SECRET is absent/blank or equal to JWT_SECRET, and PASSES (no issue)
// when REFRESH_SECRET is present and distinct from JWT_SECRET. Outside
// production, validation always passes regardless of the secrets.
describe("findRefreshSecretIssue — Property 33: Refresh secret must be present and distinct in production", () => {
  // A present, non-blank secret value.
  const presentValue = fc.string().filter((s) => s.trim() !== "");

  // A "missing" representation: absent, empty, or whitespace-only.
  const blankValue = fc.constantFrom(undefined, "", " ", "   ", "\t", "\n");

  it("in production, fails when REFRESH_SECRET is absent or blank", () => {
    fc.assert(
      fc.property(presentValue, blankValue, (jwt, refresh) => {
        const env: NodeJS.ProcessEnv = {
          NODE_ENV: "production",
          JWT_SECRET: jwt,
        };
        if (refresh !== undefined) env.REFRESH_SECRET = refresh;

        const issue = findRefreshSecretIssue(env);
        expect(issue).not.toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("in production, fails when REFRESH_SECRET equals JWT_SECRET", () => {
    fc.assert(
      fc.property(presentValue, (secret) => {
        const env: NodeJS.ProcessEnv = {
          NODE_ENV: "production",
          JWT_SECRET: secret,
          REFRESH_SECRET: secret,
        };
        expect(findRefreshSecretIssue(env)).not.toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("in production, passes when REFRESH_SECRET is present and distinct from JWT_SECRET", () => {
    // Generate two non-blank secrets that are guaranteed distinct.
    const distinctSecrets = fc
      .tuple(presentValue, presentValue)
      .filter(([jwt, refresh]) => jwt !== refresh);

    fc.assert(
      fc.property(distinctSecrets, ([jwt, refresh]) => {
        const env: NodeJS.ProcessEnv = {
          NODE_ENV: "production",
          JWT_SECRET: jwt,
          REFRESH_SECRET: refresh,
        };
        expect(findRefreshSecretIssue(env)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("outside production, always passes regardless of refresh/JWT secrets", () => {
    const nonProdNodeEnv = fc.oneof(
      fc.constantFrom(
        undefined,
        "development",
        "test",
        "staging",
        "Production", // case-sensitive: not exactly "production"
        "prod",
        "",
      ),
      fc.string().filter((s) => s !== "production"),
    );

    fc.assert(
      fc.property(
        nonProdNodeEnv,
        fc.oneof(presentValue, blankValue),
        fc.oneof(presentValue, blankValue),
        (nodeEnv, jwt, refresh) => {
          const env: NodeJS.ProcessEnv = {};
          if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
          if (jwt !== undefined) env.JWT_SECRET = jwt;
          if (refresh !== undefined) env.REFRESH_SECRET = refresh;

          expect(findRefreshSecretIssue(env)).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});
