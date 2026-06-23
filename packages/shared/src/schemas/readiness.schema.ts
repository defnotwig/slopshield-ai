import { z } from "zod";

// ---------------------------------------------------------------------------
// Readiness contract (Req 11.6, 12.4)
// ---------------------------------------------------------------------------

/**
 * Per-integration readiness status reported by the API readiness endpoint.
 *
 * - `configured`: the integration's required configuration is present and valid.
 * - `skipped`: an optional integration is not configured (this is not an error).
 * - `error`: the integration is configured but failed validation / a health check.
 */
export const IntegrationStatusEnum = z.enum([
  "configured",
  "skipped",
  "error",
]);

/** TypeScript union type for an integration's readiness status. */
export type IntegrationStatus = z.infer<typeof IntegrationStatusEnum>;

/**
 * Readiness report returned by `GET /api/health/ready`. Reports the status of
 * each optional integration without ever hard-failing: an absent optional
 * integration reports `skipped` rather than `error`.
 */
export const ReadinessReportSchema = z.object({
  /** Gemini AI reviewer integration status. */
  gemini: IntegrationStatusEnum,

  /** GitHub token (repository intake) integration status. */
  githubToken: IntegrationStatusEnum,

  /** Lark/Feishu notification integration status. */
  lark: IntegrationStatusEnum,

  /** GitHub App (PR status checks) integration status. */
  githubApp: IntegrationStatusEnum,
});

/** Typed readiness report. */
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;
