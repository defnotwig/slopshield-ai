import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Ordered pipeline stages a scan job transitions through.
 * The backend state machine enforces valid transitions between these stages.
 */
export const ScanStatusEnum = z.enum([
  "queued",
  "fetching",
  "classifying",
  "scanning",
  "ai-reviewing",
  "scoring",
  "reporting",
  "notifying",
  "completed",
  "failed",
  "cancelled",
]);

/** TypeScript union type for scan pipeline stages. */
export type ScanStatus = z.infer<typeof ScanStatusEnum>;

/**
 * Final pass/fail verdict attached to a completed scan.
 * Determined by the overall score and the presence of blocking findings.
 */
export const ScanStatusResultEnum = z.enum([
  "passed",
  "passed-with-warnings",
  "needs-cleanup",
  "risky",
  "blocked",
]);

/** TypeScript union type for scan result verdicts. */
export type ScanStatusResult = z.infer<typeof ScanStatusResultEnum>;

/**
 * Controls which scanner plugins run and how deep the analysis goes.
 * `full` runs every plugin; narrower modes skip irrelevant passes.
 */
export const ScanModeEnum = z.enum([
  "full",
  "fast",
  "security-only",
  "frontend-only",
  "backend-only",
]);

/** TypeScript union type for scan modes. */
export type ScanMode = z.infer<typeof ScanModeEnum>;

/**
 * How the source code was provided to the scanner.
 * Drives different ingestion flows in the fetching stage.
 */
export const SourceTypeEnum = z.enum([
  "paste",
  "upload",
  "repository",
  "demo-sample",
]);

/** TypeScript union type for source types. */
export type SourceType = z.infer<typeof SourceTypeEnum>;

/**
 * What initiated the scan.
 * Used for analytics, audit trails, and billing attribution.
 */
export const TriggerTypeEnum = z.enum(["manual", "webhook", "scheduled"]);

/** TypeScript union type for trigger types. */
export type TriggerType = z.infer<typeof TriggerTypeEnum>;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Real-time progress update pushed over WebSocket / SSE to the frontend
 * while a scan is in flight. Drives the progress bar and stage indicator.
 */
export const ScanProgressSchema = z.object({
  /** Current pipeline stage the scan is executing. */
  stage: ScanStatusEnum,

  /** Percentage complete within the current stage (0–100). */
  percentage: z.number().min(0).max(100),

  /** Optional human-readable status message shown under the progress bar. */
  message: z.string().optional(),
});

/** Typed progress update payload. */
export type ScanProgress = z.infer<typeof ScanProgressSchema>;

/**
 * Input DTO for creating a new scan job.
 * Validated at the API boundary before the job is enqueued.
 */
export const CreateScanInputSchema = z.object({
  /** Optional project this scan belongs to. */
  projectId: z.string().uuid().optional(),

  /** How the source code is being provided. */
  sourceType: SourceTypeEnum,

  /** Raw pasted code (required when sourceType is 'paste'). */
  sourceContent: z.string().optional(),

  /** Repository URL or upload reference (required for 'repository'/'upload'). */
  sourceRef: z.string().optional(),

  /** Which scanner plugins to run. Defaults to 'full'. */
  scanMode: ScanModeEnum.default("full"),

  /** Identifier of the demo sample to scan (required for 'demo-sample'). */
  demoSampleId: z.string().optional(),
});

/** Typed input for creating a new scan. */
export type CreateScanInput = z.infer<typeof CreateScanInputSchema>;

/**
 * Full scan job record as stored in the database and returned by the API.
 * Contains all metadata, scores, timestamps, and lifecycle state.
 */
export const ScanJobSchema = z.object({
  /** Unique scan job identifier (UUID v4). */
  id: z.string().uuid(),

  /** Optional project this scan is associated with. */
  projectId: z.string().uuid().optional(),

  /** What initiated this scan. */
  triggerType: TriggerTypeEnum,

  /** How the source code was provided. */
  sourceType: SourceTypeEnum,

  /** Repository URL, upload key, or other source reference. */
  sourceRef: z.string().optional(),

  /** Current pipeline stage. */
  status: ScanStatusEnum,

  // ── Category scores (populated after the scoring stage) ──────────────
  /** Weighted overall quality score (0–100). */
  overallScore: z.number().min(0).max(100).optional(),

  /** Security category sub-score (0–100). */
  securityScore: z.number().min(0).max(100).optional(),

  /** Maintainability category sub-score (0–100). */
  maintainabilityScore: z.number().min(0).max(100).optional(),

  /** Architecture category sub-score (0–100). */
  architectureScore: z.number().min(0).max(100).optional(),

  /** Testability category sub-score (0–100). */
  testabilityScore: z.number().min(0).max(100).optional(),

  /** Frontend category sub-score (0–100). */
  frontendScore: z.number().min(0).max(100).optional(),

  /** Backend category sub-score (0–100). */
  backendScore: z.number().min(0).max(100).optional(),

  // ── Verdict ──────────────────────────────────────────────────────────
  /** Final pass/fail verdict. Set after scoring completes. */
  statusResult: ScanStatusResultEnum.optional(),

  // ── Audit / lifecycle timestamps ─────────────────────────────────────
  /** User who initiated the scan. Null for webhook / scheduled scans. */
  startedBy: z.string().uuid().optional(),

  /** ISO-8601 timestamp when the scan began processing. */
  startedAt: z.string().datetime().optional(),

  /** ISO-8601 timestamp when the scan finished (completed, failed, or cancelled). */
  completedAt: z.string().datetime().optional(),

  /** ISO-8601 timestamp when the scan record was created. */
  createdAt: z.string().datetime(),

  /** ISO-8601 timestamp of the last update to this record. */
  updatedAt: z.string().datetime(),
});

/** Fully-typed scan job record. */
export type ScanJob = z.infer<typeof ScanJobSchema>;
