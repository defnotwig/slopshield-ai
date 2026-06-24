import { z } from "zod";
import { FindingSeverityEnum } from "./finding.schema.js";

// ---------------------------------------------------------------------------
// AI Finding Schema
// ---------------------------------------------------------------------------

/**
 * Schema for a single finding produced by the AI reviewer.
 * This matches the structured JSON output format defined in PRD Section 22.2
 * that the LLM is instructed to return.
 *
 * Field names use snake_case to align with the LLM prompt template,
 * keeping parsing straightforward. The backend maps these to the canonical
 * `FindingSchema` (camelCase) before persisting.
 */
export const AIFindingSchema = z.object({
  /** Severity level of the AI-detected issue. */
  severity: FindingSeverityEnum,

  /** Free-form category label assigned by the AI (e.g. "security", "architecture"). */
  category: z.string(),

  /** Short descriptive title of the issue. */
  title: z.string(),

  /** Relative file path where the issue was found. */
  file: z.string(),

  /** Line number in the file (1-indexed). Optional for project-wide observations. */
  line: z.number().int().positive().nullish().transform((v) => v ?? undefined),

  /** Reference to an external standard (e.g. "OWASP A03:2021"). */
  standard: z.string().nullish().transform((v) => v ?? undefined),

  /** Plain-language explanation of the risk or impact. */
  why_it_matters: z.string().nullish().transform((v) => v ?? ""),

  /** Actionable fix recommendation. */
  recommendation: z.string().nullish().transform((v) => v ?? ""),

  /**
   * Optional test cases the team should add to verify the fix for this specific
   * finding. Persisted per-finding (previously dropped on the floor).
   */
  suggested_tests: z.array(z.string()).nullish().transform((v) => v ?? undefined),

  /**
   * Optional short excerpt of the offending code (a few lines). Lets AI findings
   * show a snippet in the report drawer just like static-analyzer findings.
   */
  code_snippet: z.string().nullish().transform((v) => v ?? undefined),

  /**
   * Whether this finding alone should block a merge.
   * The AI is instructed to set this `true` only for high-confidence critical issues.
   * Defaults to false when the model omits it.
   */
  blocking: z.boolean().nullish().transform((v) => v ?? false),

  /**
   * The AI's self-reported confidence that this is a true positive (0–1).
   * Findings below a configurable threshold are down-ranked in the report.
   * Defaults to 0.5 when the model omits it.
   */
  confidence: z.number().min(0).max(1).nullish().transform((v) => v ?? 0.5),
});

/** Typed representation of a single AI-produced finding. */
export type AIFinding = z.infer<typeof AIFindingSchema>;

// ---------------------------------------------------------------------------
// AI Review Result Schema
// ---------------------------------------------------------------------------

/**
 * Top-level schema for the full structured response returned by the AI
 * reviewer after analyzing a codebase. This is the shape the backend
 * `JSON.parse()`s from the LLM completion and validates with Zod.
 */
export const AIReviewResultSchema = z.object({
  /** High-level natural-language summary of the code quality assessment. */
  summary: z.string().nullish().transform((v) => v ?? "AI review completed."),

  /** Array of individual findings the AI detected. */
  findings: z.array(AIFindingSchema).nullish().transform((v) => v ?? []),

  /** Suggested test cases the team should write based on the analysis. */
  recommended_tests: z.array(z.string()).nullish().transform((v) => v ?? []),

  /** Ordered steps for a refactoring plan to address the found issues. */
  refactor_plan: z.array(z.string()).nullish().transform((v) => v ?? []),
});

/** Fully-typed AI review result payload. */
export type AIReviewResult = z.infer<typeof AIReviewResultSchema>;
