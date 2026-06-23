import { z } from "zod";
import { FindingCategoryEnum } from "./finding.schema.js";

// ---------------------------------------------------------------------------
// Dashboard Contract Types
// ---------------------------------------------------------------------------
//
// These shapes are the single source of truth for the dashboard payloads the
// API serves and the Web_App renders. The API computes them from real
// ScanJob/Finding records and validates against these schemas; the Web_App
// imports the inferred types instead of free-typing the field names so the two
// sides can never drift (resolves audit finding A2).

/**
 * Aggregate key-performance-indicator summary for the dashboard header cards.
 * Every count is a non-negative integer and the average score is bounded to
 * the 0–100 scoring range.
 */
export const DashboardSummarySchema = z.object({
  /** Total number of scans the user/project has run. */
  totalScans: z.number().int().min(0),

  /** Mean overall score across all scans (0–100). */
  averageScore: z.number().min(0).max(100),

  /** Number of scans whose verdict was blocked. */
  blockedScans: z.number().int().min(0),

  /** Number of scans whose verdict passed. */
  passedScans: z.number().int().min(0),

  /** Number of scans that passed with warnings. */
  warningScans: z.number().int().min(0),
});

/** Typed dashboard summary payload. */
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

/**
 * A single point on the score-over-time trend line. One point per completed
 * scan, ordered chronologically by the consumer.
 */
export const DashboardTrendPointSchema = z.object({
  /** The scan this point represents. */
  scanId: z.string(),

  /** Calendar date of the scan in `YYYY-MM-DD` form. */
  date: z.string(),

  /** Overall score recorded for the scan (0–100). */
  score: z.number().min(0).max(100),
});

/** Typed trend-line data point. */
export type DashboardTrendPoint = z.infer<typeof DashboardTrendPointSchema>;

/**
 * One bar in the "top issues" breakdown — the most frequently occurring
 * finding categories across the user's scans.
 */
export const TopIssueSchema = z.object({
  /** Quality category the issue falls under (shared FindingCategory). */
  category: FindingCategoryEnum,

  /** Short human-readable title for the issue grouping. */
  title: z.string(),

  /** Number of findings in this category. */
  count: z.number().int().min(0),
});

/** Typed top-issue breakdown entry. */
export type TopIssue = z.infer<typeof TopIssueSchema>;

/**
 * One bar in the "standards violations" breakdown — how often each external
 * standard reference (e.g. OWASP, CWE, WCAG) is implicated across findings.
 */
export const StandardViolationSchema = z.object({
  /** The external standard reference label (e.g. "OWASP A01:2021"). */
  standard: z.string(),

  /** Number of findings referencing this standard. */
  count: z.number().int().min(0),
});

/** Typed standard-violation breakdown entry. */
export type StandardViolation = z.infer<typeof StandardViolationSchema>;
