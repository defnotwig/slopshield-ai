import { z } from 'zod';
import { ScanStatusResultEnum } from './scan.schema.js';

// ---------------------------------------------------------------------------
// Category Scores
// ---------------------------------------------------------------------------

/**
 * Per-category quality scores (0–100) computed by the scoring engine.
 * Each category is scored independently and then combined into the
 * weighted overall score using the weights defined in
 * `constants/categories.ts`.
 */
export const CategoryScoresSchema = z.object({
  /** Security category score (backend + frontend security findings). */
  security: z.number().min(0).max(100),

  /** Maintainability category score (code smells, complexity, naming). */
  maintainability: z.number().min(0).max(100),

  /** Architecture category score (layering, boundaries, patterns). */
  architecture: z.number().min(0).max(100),

  /** Testability category score (coverage gaps, untestable patterns). */
  testability: z.number().min(0).max(100),

  /** Frontend-specific category score (a11y, component patterns, perf). */
  frontend: z.number().min(0).max(100),

  /** Reliability category score (error handling, resilience patterns). */
  reliability: z.number().min(0).max(100),

  /** Documentation category score (missing docs, stale comments). */
  documentation: z.number().min(0).max(100),
});

/** Typed per-category scores object. */
export type CategoryScores = z.infer<typeof CategoryScoresSchema>;

// ---------------------------------------------------------------------------
// Full Scan Score
// ---------------------------------------------------------------------------

/**
 * Complete scoring output for a finished scan. This is the payload
 * persisted alongside the scan job and served to the report UI.
 */
export const ScanScoreSchema = z.object({
  /** Weighted overall quality score (0–100). */
  overallScore: z.number().min(0).max(100),

  /** Breakdown of scores by quality category. */
  categoryScores: CategoryScoresSchema,

  /** Final pass/fail verdict derived from the overall score. */
  statusResult: ScanStatusResultEnum,

  /**
   * Human-readable descriptions of why the scan was blocked.
   * Empty array when the scan is not blocked.
   */
  blockedReasons: z.array(z.string()),

  /** Total number of findings across all severities. */
  totalFindings: z.number().int().min(0),

  /** Number of critical-severity findings. */
  criticalCount: z.number().int().min(0),

  /** Number of high-severity findings. */
  highCount: z.number().int().min(0),

  /** Number of medium-severity findings. */
  mediumCount: z.number().int().min(0),

  /** Number of low-severity findings. */
  lowCount: z.number().int().min(0),

  /** Number of informational findings. */
  infoCount: z.number().int().min(0),
});

/** Fully-typed scan score result. */
export type ScanScore = z.infer<typeof ScanScoreSchema>;
