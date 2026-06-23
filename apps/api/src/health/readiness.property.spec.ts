// Feature: production-grade-system, Property 34: Readiness reports a valid status per integration and never hard-fails
//
// Property 34: Readiness reports a valid status per integration and never hard-fails.
// Validates: Requirements 11.4, 11.6, 11.7, 12.4
//
// For any environment configuration, the readiness computation returns a status
// in {configured, skipped, error} for each of Gemini, GitHub token, and Lark
// without throwing. An absent optional integration is reported as `skipped`, and
// a present, non-blank one as `configured`. Because the computation never throws
// for any presence/absence of these optional keys, startup can never hard-fail
// on them.

import { ReadinessReportSchema } from "@slopshield/shared";
import fc from "fast-check";

import { computeReadiness } from "../common/env";
import { HealthController } from "./health.controller";

/**
 * Backing environment variable for each optional integration. Mirrors the
 * mapping in `common/env.ts`; duplicated here so the test asserts the contract
 * independently of the implementation's private constant.
 */
const INTEGRATION_ENV = {
  gemini: "GEMINI_API_KEY",
  githubToken: "GITHUB_TOKEN",
  lark: "LARK_WEBHOOK_URL",
} as const;

type IntegrationKey = keyof typeof INTEGRATION_ENV;
const INTEGRATION_KEYS = Object.keys(INTEGRATION_ENV) as IntegrationKey[];

/**
 * Independent oracle: an env value counts as `configured` only when it is
 * present and non-blank; otherwise the integration is `skipped`.
 */
function expectedStatus(raw: string | undefined): "configured" | "skipped" {
  return raw !== undefined && raw.trim() !== "" ? "configured" : "skipped";
}

/**
 * Generates a single env-var value covering the meaningful classes of input:
 *   - absent (undefined → key omitted from the env object),
 *   - blank (empty / whitespace-only → still "not configured"),
 *   - arbitrary non-empty strings (a present value → "configured").
 */
const envValueArb = fc.option(
  fc.oneof(
    fc.constantFrom("", "   ", "\t", "\n", " \t \n "),
    fc.string(),
    fc.string({ minLength: 1 }).map((s) => `value-${s}`),
  ),
  { nil: undefined },
);

/** Generates a partial env spec for the three optional integration keys. */
const envSpecArb = fc.record({
  gemini: envValueArb,
  githubToken: envValueArb,
  lark: envValueArb,
});

function buildEnv(spec: Partial<Record<IntegrationKey, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of INTEGRATION_KEYS) {
    const value = spec[key];
    if (value !== undefined) env[INTEGRATION_ENV[key]] = value;
  }
  return env;
}

describe("computeReadiness — Property 34: valid status per integration, never hard-fails", () => {
  it("returns a schema-valid report and never throws for any env", () => {
    fc.assert(
      fc.property(envSpecArb, (spec) => {
        const env = buildEnv(spec);

        // Never hard-fails (Req 11.4, 11.6).
        const report = computeReadiness(env);

        // Conforms to the shared contract: every value ∈ {configured, skipped,
        // error} for exactly the three integrations (Req 11.6, 12.4).
        expect(ReadinessReportSchema.safeParse(report).success).toBe(true);

        // Per-integration correctness: present+non-blank → configured, else
        // skipped; absent optional → skipped (Req 11.7).
        for (const key of INTEGRATION_KEYS) {
          expect(report[key]).toBe(expectedStatus(spec[key]));
        }
      }),
      { numRuns: 300 },
    );
  });

  it("the readiness endpoint mirrors computeReadiness without throwing", () => {
    const ENV_KEYS = Object.values(INTEGRATION_ENV);
    const saved: Record<string, string | undefined> = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];

    try {
      fc.assert(
        fc.property(envSpecArb, (spec) => {
          // Apply the generated env to the real process env, since the endpoint
          // reads process.env via computeReadiness()'s default argument.
          for (const key of INTEGRATION_KEYS) {
            const envName = INTEGRATION_ENV[key];
            const value = spec[key];
            if (value === undefined) delete process.env[envName];
            else process.env[envName] = value;
          }

          const controller = new HealthController();
          let report!: ReturnType<HealthController["ready"]>;
          expect(() => {
            report = controller.ready();
          }).not.toThrow();

          expect(ReadinessReportSchema.safeParse(report).success).toBe(true);
          for (const key of INTEGRATION_KEYS) {
            expect(report[key]).toBe(expectedStatus(spec[key]));
          }
        }),
        { numRuns: 100 },
      );
    } finally {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
