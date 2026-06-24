import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Severity levels for findings, ordered from most to least critical.
 * Determines point deductions when computing the overall scan score.
 */
export const FindingSeverityEnum = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

/** TypeScript union type derived from the FindingSeverity Zod enum. */
export type FindingSeverity = z.infer<typeof FindingSeverityEnum>;

/**
 * High-level categories that each finding belongs to.
 * Maps directly to the weighted category scores on the scan dashboard.
 */
export const FindingCategoryEnum = z.enum([
  "backend-security",
  "frontend-security",
  "backend-architecture",
  "frontend-architecture",
  "maintainability",
  "testability",
  "accessibility",
  "reliability",
  "documentation",
  "general",
]);

/** TypeScript union type derived from the FindingCategory Zod enum. */
export type FindingCategory = z.infer<typeof FindingCategoryEnum>;

/**
 * The tool or analysis pass that originally produced the finding.
 * Used for attribution, deduplication, and filtering in the UI.
 */
export const FindingSourceEnum = z.enum([
  "eslint",
  "typescript",
  "secret-scanner",
  "semgrep",
  "rules-engine",
  "ai-reviewer",
  "architecture",
  "dependency",
  "accessibility",
  "custom-rules",
]);

/** TypeScript union type derived from the FindingSource Zod enum. */
export type FindingSource = z.infer<typeof FindingSourceEnum>;

// ---------------------------------------------------------------------------
// Finding Schema
// ---------------------------------------------------------------------------

/**
 * Schema for a single finding produced by any scanner plugin or the AI
 * reviewer. This is the atomic unit of analysis that feeds into the scoring
 * engine and the report builder.
 *
 * @example
 * ```ts
 * const parsed = FindingSchema.parse(rawFinding);
 * ```
 */
export const FindingSchema = z.object({
  /** Unique identifier for this finding (ULID or UUID). */
  id: z.string(),

  /** The scan job that produced this finding. */
  scanId: z.string(),

  /** How severe this finding is — drives score deductions. */
  severity: FindingSeverityEnum,

  /** Which quality category this finding falls under. */
  category: FindingCategoryEnum,

  /** Short human-readable title shown in the dashboard card. */
  title: z.string(),

  /** Relative file path where the issue was detected. */
  file: z.string(),

  /** Line number in the file (1-indexed). Absent for project-level issues. */
  line: z.number().int().positive().optional(),

  /**
   * References to external security / quality standards that this finding
   * relates to (e.g. "OWASP A01:2021", "CWE-79", "WCAG 2.2 SC 1.1.1").
   */
  standardReferences: z.array(z.string()),

  /** Plain-language explanation of why this issue matters to the team. */
  whyItMatters: z.string(),

  /** Actionable recommendation for how to fix the issue. */
  recommendation: z.string(),

  /** Optional list of test cases the team should add to cover this issue. */
  suggestedTests: z.array(z.string()).optional(),

  /**
   * When `true`, this finding alone is enough to mark the scan as "blocked"
   * and prevent a merge in an integrated CI workflow.
   */
  blocking: z.boolean(),

  /**
   * Confidence score between 0 and 1 indicating how certain the scanner
   * is that this finding is a true positive.
   */
  confidence: z.number().min(0).max(1),

  /** Which scanner or analysis pass produced this finding. */
  source: FindingSourceEnum,

  /** Optional source code snippet showing the problematic lines. */
  codeSnippet: z.string().optional(),
});

/** Fully-typed representation of a single scan finding. */
export type Finding = z.infer<typeof FindingSchema>;
