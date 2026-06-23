/**
 * Environment configuration validation for the GitHub App integration.
 *
 * Uses Zod to validate and coerce all GitHub App environment variables.
 * When the feature is disabled (`GITHUB_APP_ENABLED` absent or "false"),
 * credential variables are not required. When enabled, missing credentials
 * are logged as errors but do not crash the process.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import { z } from "zod";
import { Logger } from "@nestjs/common";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Coerces a string env value to boolean. Accepts "true"/"false" (case-
 * insensitive), defaulting to `false` when absent or unrecognized.
 */
const booleanString = z
  .string()
  .optional()
  .transform((val) => val?.trim().toLowerCase() === "true")
  .pipe(z.boolean());

/**
 * Zod schema for all GitHub App environment variables.
 *
 * - GITHUB_APP_ENABLED: boolean (coerced from string), defaults false
 * - GITHUB_APP_ID: string, required when enabled
 * - GITHUB_APP_PRIVATE_KEY: string, required when enabled
 * - GITHUB_APP_WEBHOOK_SECRET: string, required when enabled
 * - GITHUB_APP_SCAN_TIMEOUT: number (seconds), default 300
 * - GITHUB_APP_RATE_LIMIT_PER_INSTALLATION: number (per hour), default 60
 * - GITHUB_APP_GLOBAL_CONCURRENT_SCANS: number, default 10
 */
export const GitHubAppEnvSchema = z.object({
  GITHUB_APP_ENABLED: booleanString.default("false"),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_SCAN_TIMEOUT: z
    .string()
    .optional()
    .transform((val) => (val ? Number(val) : 300))
    .pipe(z.number().int().positive()),
  GITHUB_APP_RATE_LIMIT_PER_INSTALLATION: z
    .string()
    .optional()
    .transform((val) => (val ? Number(val) : 60))
    .pipe(z.number().int().positive()),
  GITHUB_APP_GLOBAL_CONCURRENT_SCANS: z
    .string()
    .optional()
    .transform((val) => (val ? Number(val) : 10))
    .pipe(z.number().int().positive()),
});

export type GitHubAppEnv = z.infer<typeof GitHubAppEnvSchema>;

// ---------------------------------------------------------------------------
// Validated configuration interface
// ---------------------------------------------------------------------------

export interface GitHubAppConfig {
  /** Whether the GitHub App integration is enabled. */
  enabled: boolean;
  /** The GitHub App ID. Undefined when disabled or credentials missing. */
  appId?: string;
  /** The PEM-encoded private key. Undefined when disabled or credentials missing. */
  privateKey?: string;
  /** The webhook HMAC secret. Undefined when disabled or credentials missing. */
  webhookSecret?: string;
  /** Maximum time in seconds for a PR-triggered scan before timeout. */
  scanTimeout: number;
  /** Maximum webhook-triggered scans per installation per hour. */
  rateLimitPerInstallation: number;
  /** Maximum concurrent PR-triggered scans globally. */
  globalConcurrentScans: number;
  /** Whether credentials are fully configured (enabled + all credentials present). */
  credentialsConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const logger = new Logger("GitHubAppConfig");

/**
 * Required credential keys when the GitHub App feature is enabled.
 */
const REQUIRED_CREDENTIALS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_WEBHOOK_SECRET",
] as const;

/**
 * Verify that all required credentials are present and non-blank in the parsed
 * config. Logs an error listing the missing keys when any are absent.
 * Returns `true` when all credentials are present.
 */
function checkCredentials(parsed: GitHubAppEnv): boolean {
  const missing = REQUIRED_CREDENTIALS.filter((key) => {
    const value = parsed[key];
    return value === undefined || value.trim() === "";
  });

  if (missing.length > 0) {
    logger.error(
      `GitHub App is enabled but missing required credentials: ${missing.join(", ")}. ` +
        `Webhook processing will be disabled until credentials are provided.`,
    );
    return false;
  }
  return true;
}

/**
 * Load and validate the GitHub App configuration from the environment.
 *
 * Behavior:
 * - Parses env vars through the Zod schema (applying defaults and coercion).
 * - When enabled, checks that all credential variables are present and non-blank.
 * - If credentials are missing while enabled, logs an error but does NOT throw
 *   (Req 11.2 — "log error at startup without crashing").
 * - When disabled (`GITHUB_APP_ENABLED` is absent or "false"), credentials are
 *   not required and the config reports `credentialsConfigured: false`.
 *
 * @param env - The process environment object. Defaults to `process.env`.
 */
export function loadGitHubAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): GitHubAppConfig {
  const parsed = GitHubAppEnvSchema.parse({
    GITHUB_APP_ENABLED: env.GITHUB_APP_ENABLED,
    GITHUB_APP_ID: env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_WEBHOOK_SECRET: env.GITHUB_APP_WEBHOOK_SECRET,
    GITHUB_APP_SCAN_TIMEOUT: env.GITHUB_APP_SCAN_TIMEOUT,
    GITHUB_APP_RATE_LIMIT_PER_INSTALLATION:
      env.GITHUB_APP_RATE_LIMIT_PER_INSTALLATION,
    GITHUB_APP_GLOBAL_CONCURRENT_SCANS: env.GITHUB_APP_GLOBAL_CONCURRENT_SCANS,
  });

  const enabled = parsed.GITHUB_APP_ENABLED;

  // Check credential completeness when enabled.
  const credentialsConfigured = enabled && checkCredentials(parsed);

  return {
    enabled,
    appId: parsed.GITHUB_APP_ID || undefined,
    privateKey: parsed.GITHUB_APP_PRIVATE_KEY || undefined,
    webhookSecret: parsed.GITHUB_APP_WEBHOOK_SECRET || undefined,
    scanTimeout: parsed.GITHUB_APP_SCAN_TIMEOUT,
    rateLimitPerInstallation: parsed.GITHUB_APP_RATE_LIMIT_PER_INSTALLATION,
    globalConcurrentScans: parsed.GITHUB_APP_GLOBAL_CONCURRENT_SCANS,
    credentialsConfigured,
  };
}

// ---------------------------------------------------------------------------
// Feature status helper
// ---------------------------------------------------------------------------

/**
 * Determine the GitHub App integration status for readiness reporting.
 *
 * Returns:
 * - `'configured'` when the feature is enabled and all credentials are present.
 * - `'skipped'` when the feature is disabled.
 * - `'error'` when the feature is enabled but credentials are missing.
 *
 * Validates: Requirement 11.7
 */
export function getGitHubAppStatus(
  env: NodeJS.ProcessEnv = process.env,
): "configured" | "skipped" | "error" {
  const config = loadGitHubAppConfig(env);
  if (!config.enabled) return "skipped";
  return config.credentialsConfigured ? "configured" : "error";
}

/**
 * Check whether the GitHub App feature is fully operational (enabled with
 * valid credentials). Convenience helper for conditional module registration.
 */
export function isGitHubAppEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const config = loadGitHubAppConfig(env);
  return config.enabled && config.credentialsConfigured;
}
