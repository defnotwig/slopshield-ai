// Feature: github-pr-status-checks, Property 16: Readiness endpoint reports correct GitHub App status
//
// **Validates: Requirements 11.7**
//
// For any combination of environment configuration (all credentials present,
// some missing, feature disabled), getGitHubAppStatus(env) reports exactly one
// of 'configured' (enabled + all credentials present), 'skipped' (feature
// disabled), or 'error' (enabled but credentials missing/empty).

import fc from "fast-check";

import { getGitHubAppStatus } from "./github-app.config";

/**
 * The three credential keys that must be present and non-empty when the feature
 * is enabled for the status to be 'configured'.
 */
const CREDENTIAL_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_WEBHOOK_SECRET",
] as const;

/**
 * Generates an env value that is either absent (undefined), blank, or a
 * non-empty string representing a real credential.
 */
const envValueArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom("", "   ", "\t"),
  fc.string({ minLength: 1 }).map((s) => `credential-${s}`),
);

/**
 * Generates values that are NOT exactly "true" — covering absent, "false",
 * random strings, and similar values that should disable the feature.
 */
const notTrueArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom("false", "FALSE", "False", "0", "no", ""),
  fc.string().filter((s) => s.trim().toLowerCase() !== "true"),
);

/**
 * Generates a non-empty, non-blank string representing a valid credential value.
 */
const nonEmptyCredentialArb = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim() !== "")
  .map((s) => `cred-${s}`);

/**
 * Helper to build a process.env-like object from optional values.
 */
function buildEnv(spec: {
  GITHUB_APP_ENABLED?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_WEBHOOK_SECRET?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (spec.GITHUB_APP_ENABLED !== undefined)
    env.GITHUB_APP_ENABLED = spec.GITHUB_APP_ENABLED;
  if (spec.GITHUB_APP_ID !== undefined)
    env.GITHUB_APP_ID = spec.GITHUB_APP_ID;
  if (spec.GITHUB_APP_PRIVATE_KEY !== undefined)
    env.GITHUB_APP_PRIVATE_KEY = spec.GITHUB_APP_PRIVATE_KEY;
  if (spec.GITHUB_APP_WEBHOOK_SECRET !== undefined)
    env.GITHUB_APP_WEBHOOK_SECRET = spec.GITHUB_APP_WEBHOOK_SECRET;
  return env;
}

describe("getGitHubAppStatus — Property 16: Readiness endpoint reports correct GitHub App status", () => {
  it("returns 'skipped' when GITHUB_APP_ENABLED is not 'true'", () => {
    fc.assert(
      fc.property(notTrueArb, envValueArb, envValueArb, envValueArb, (enabled, id, key, secret) => {
        const env = buildEnv({
          GITHUB_APP_ENABLED: enabled,
          GITHUB_APP_ID: id,
          GITHUB_APP_PRIVATE_KEY: key,
          GITHUB_APP_WEBHOOK_SECRET: secret,
        });

        const status = getGitHubAppStatus(env);
        expect(status).toBe("skipped");
      }),
      { numRuns: 100 },
    );
  });

  it("returns 'configured' when GITHUB_APP_ENABLED is 'true' and all credentials are non-empty", () => {
    fc.assert(
      fc.property(
        nonEmptyCredentialArb,
        nonEmptyCredentialArb,
        nonEmptyCredentialArb,
        (id, key, secret) => {
          const env = buildEnv({
            GITHUB_APP_ENABLED: "true",
            GITHUB_APP_ID: id,
            GITHUB_APP_PRIVATE_KEY: key,
            GITHUB_APP_WEBHOOK_SECRET: secret,
          });

          const status = getGitHubAppStatus(env);
          expect(status).toBe("configured");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns 'error' when GITHUB_APP_ENABLED is 'true' and at least one credential is missing or empty", () => {
    // Generate credential specs where at least one is missing or empty.
    // We generate all three credentials, then ensure at least one is undefined or blank.
    const credentialWithAtLeastOneMissing = fc
      .record({
        GITHUB_APP_ID: envValueArb,
        GITHUB_APP_PRIVATE_KEY: envValueArb,
        GITHUB_APP_WEBHOOK_SECRET: envValueArb,
      })
      .filter((spec) => {
        // At least one credential must be missing (undefined) or blank (empty/whitespace)
        return CREDENTIAL_KEYS.some((k) => {
          const val = spec[k];
          return val === undefined || val.trim() === "";
        });
      });

    fc.assert(
      fc.property(credentialWithAtLeastOneMissing, (creds) => {
        const env = buildEnv({
          GITHUB_APP_ENABLED: "true",
          ...creds,
        });

        const status = getGitHubAppStatus(env);
        expect(status).toBe("error");
      }),
      { numRuns: 100 },
    );
  });

  it("always returns one of the three valid statuses for any env configuration", () => {
    const anyEnvArb = fc.record({
      GITHUB_APP_ENABLED: fc.option(fc.string(), { nil: undefined }),
      GITHUB_APP_ID: fc.option(fc.string(), { nil: undefined }),
      GITHUB_APP_PRIVATE_KEY: fc.option(fc.string(), { nil: undefined }),
      GITHUB_APP_WEBHOOK_SECRET: fc.option(fc.string(), { nil: undefined }),
    });

    fc.assert(
      fc.property(anyEnvArb, (spec) => {
        const env = buildEnv(spec);
        const status = getGitHubAppStatus(env);
        expect(["configured", "skipped", "error"]).toContain(status);
      }),
      { numRuns: 100 },
    );
  });
});
