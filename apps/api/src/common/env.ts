/**
 * Pure environment helpers for port resolution, required-env validation, and
 * heavy-analyzer file capping. Kept free of NestJS dependencies so the logic
 * can be exercised by property tests independently of the bootstrap.
 */

import type { ReadinessReport } from "@slopshield/shared";
import { getGitHubAppStatus } from "../github-app/github-app.config";

/**
 * Resolve the port the API should listen on.
 *
 * Precedence: `PORT` (when a valid positive integer) → `API_PORT` (when valid)
 * → `3001`.
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  // Evaluate PORT and API_PORT independently: return the first that parses to
  // a valid positive integer, so an invalid PORT (e.g. "0", "", "notaport")
  // falls back to a valid API_PORT rather than the 3001 default.
  const parsePort = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  return parsePort(env.PORT) ?? parsePort(env.API_PORT) ?? 3001; // default
}

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "CORS_ORIGIN",
] as const;

/**
 * In production, return the required variables that are absent or blank.
 * Returns an empty list outside production.
 */
export function findMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  return REQUIRED_IN_PRODUCTION.filter((k) => {
    const value = env[k];
    return value === undefined || value.trim() === "";
  });
}

/**
 * In production, verify that `REFRESH_SECRET` is present and distinct from
 * `JWT_SECRET`, with no insecure literal fallback (Req 11.3).
 *
 * Returns a human-readable issue describing the first problem found, or `null`
 * when the configuration is valid. Outside production this always returns
 * `null` so local/test runs can use dev defaults without secret-shaped
 * literals.
 *
 * - Returns an issue when `REFRESH_SECRET` is absent or blank.
 * - Returns an issue when `REFRESH_SECRET` equals `JWT_SECRET` (not distinct).
 * - Returns `null` when `REFRESH_SECRET` is present and distinct from
 *   `JWT_SECRET`.
 */
export function findRefreshSecretIssue(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.NODE_ENV !== "production") return null;

  const refresh = env.REFRESH_SECRET;
  if (refresh === undefined || refresh.trim() === "") {
    return "REFRESH_SECRET is required in production";
  }

  if (refresh === env.JWT_SECRET) {
    return "REFRESH_SECRET must be distinct from JWT_SECRET in production";
  }

  return null;
}

/**
 * Bound the number of files sent to memory/CPU-heavy analyzers.
 *
 * Returns at most `max` elements as an order-preserving prefix of `files`.
 * A negative `max` returns all files unchanged.
 */
export function capFiles<T>(files: T[], max: number): T[] {
  return max >= 0 ? files.slice(0, max) : files;
}

/**
 * Configurable heavy-analyzer file cap, read from `MAX_ANALYZE_FILES`
 * (default `50`).
 */
export const maxAnalyzeFiles = (): number =>
  Number(process.env.MAX_ANALYZE_FILES ?? 50);

// ---------------------------------------------------------------------------
// Optional-integration readiness (Req 11.5, 11.6, 11.7)
// ---------------------------------------------------------------------------

/**
 * Environment variable that configures each simple optional integration. An
 * absent or blank value means the integration is not configured and is reported
 * as `skipped` rather than `error`. The GitHub App integration uses a separate
 * multi-variable check via `getGitHubAppStatus`.
 */
const INTEGRATION_ENV_KEYS = {
  gemini: "GEMINI_API_KEY",
  githubToken: "GITHUB_TOKEN",
  lark: "LARK_WEBHOOK_URL",
} as const;

/** True when an env value is present and non-blank. */
function isConfigured(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

/**
 * Compute the per-integration readiness report for the optional integrations
 * (Gemini, GitHub token, Lark, GitHub App).
 *
 * Each simple integration is reported as `configured` when its backing
 * environment variable is present and non-blank, and `skipped` when absent or
 * blank. The GitHub App integration uses a more complex check via
 * `getGitHubAppStatus` which reports `configured`, `skipped`, or `error`.
 * This function never throws so it can never hard-fail startup or the
 * readiness endpoint (Req 11.4, 11.6, 11.7).
 */
export function computeReadiness(
  env: NodeJS.ProcessEnv = process.env,
): ReadinessReport {
  return {
    gemini: isConfigured(env[INTEGRATION_ENV_KEYS.gemini])
      ? "configured"
      : "skipped",
    githubToken: isConfigured(env[INTEGRATION_ENV_KEYS.githubToken])
      ? "configured"
      : "skipped",
    lark: isConfigured(env[INTEGRATION_ENV_KEYS.lark])
      ? "configured"
      : "skipped",
    githubApp: getGitHubAppStatus(env),
  };
}

/**
 * Build the one-time startup summary line describing each Integration's
 * readiness as `configured`, `skipped`, or `error` (Req 11.5).
 */
export function formatIntegrationSummary(
  report: ReadinessReport = computeReadiness(),
): string {
  return `Integrations: gemini=${report.gemini}, githubToken=${report.githubToken}, lark=${report.lark}, githubApp=${report.githubApp}`;
}

// ---------------------------------------------------------------------------
// OAuth configuration (optional — Requirements 5.1, 6.1, 7.3)
// ---------------------------------------------------------------------------

/**
 * Environment variables for the OAuth integrations.
 * These are optional: the OAuth module gracefully degrades when they are absent.
 */
export const OAUTH_ENV_KEYS = {
  GITHUB_OAUTH_CLIENT_ID: "GITHUB_OAUTH_CLIENT_ID",
  GITHUB_OAUTH_CLIENT_SECRET: "GITHUB_OAUTH_CLIENT_SECRET",
  GITHUB_OAUTH_CALLBACK_URL: "GITHUB_OAUTH_CALLBACK_URL",
  LARK_OAUTH_APP_ID: "LARK_OAUTH_APP_ID",
  LARK_OAUTH_APP_SECRET: "LARK_OAUTH_APP_SECRET",
  LARK_OAUTH_CALLBACK_URL: "LARK_OAUTH_CALLBACK_URL",
  OAUTH_ENCRYPTION_KEY: "OAUTH_ENCRYPTION_KEY",
} as const;

/**
 * Returns true when GitHub OAuth is fully configured (client ID, secret, and
 * callback URL are all present and non-blank).
 */
export function isGitHubOAuthConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isConfigured(env.GITHUB_OAUTH_CLIENT_ID) &&
    isConfigured(env.GITHUB_OAUTH_CLIENT_SECRET) &&
    isConfigured(env.GITHUB_OAUTH_CALLBACK_URL)
  );
}

/**
 * Returns true when Lark OAuth is fully configured (app ID, secret, and
 * callback URL are all present and non-blank).
 */
export function isLarkOAuthConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isConfigured(env.LARK_OAUTH_APP_ID) &&
    isConfigured(env.LARK_OAUTH_APP_SECRET) &&
    isConfigured(env.LARK_OAUTH_CALLBACK_URL)
  );
}

/**
 * Returns true when the OAuth encryption key is configured (required for any
 * OAuth token storage).
 */
export function isOAuthEncryptionConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isConfigured(env.OAUTH_ENCRYPTION_KEY);
}
