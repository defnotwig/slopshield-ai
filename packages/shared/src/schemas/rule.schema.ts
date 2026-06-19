import { z } from 'zod';
import { FindingSeverityEnum } from './finding.schema.js';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * Detection configuration for a rule.
 * Contains glob or regex patterns the rules engine uses to match against
 * file contents, AST nodes, or file paths.
 */
export const RuleDetectionSchema = z.object({
  /**
   * Array of patterns (glob, regex, or AST selectors depending on the
   * scanner plugin) used to detect violations of this rule.
   */
  patterns: z.array(z.string()),
});

/** Typed detection configuration. */
export type RuleDetection = z.infer<typeof RuleDetectionSchema>;

// ---------------------------------------------------------------------------
// Applies-To enum
// ---------------------------------------------------------------------------

/**
 * Target contexts a rule can apply to.
 * The rules engine uses this to skip rules that are irrelevant for the
 * current scan mode (e.g. frontend-only scans skip 'backend' rules).
 */
export const RuleAppliesToEnum = z.enum([
  'frontend',
  'backend',
  'general',
]);

/** TypeScript union for rule applicability targets. */
export type RuleAppliesTo = z.infer<typeof RuleAppliesToEnum>;

// ---------------------------------------------------------------------------
// Rule Schema
// ---------------------------------------------------------------------------

/**
 * Schema for a single configurable rule in the SlopShield rules engine
 * (PRD Section 15). Rules are typically authored in YAML files and loaded
 * at application startup. Each rule maps to zero or more findings per scan.
 *
 * @example
 * ```yaml
 * rule_id: SS-SEC-001
 * title: Hardcoded Secret Detected
 * category: backend-security
 * severity: critical
 * blocking: true
 * ```
 */
export const RuleSchema = z.object({
  /** Unique rule identifier (e.g. "SS-SEC-001"). */
  rule_id: z.string(),

  /** Human-readable title shown in findings and the dashboard. */
  title: z.string(),

  /** Quality category this rule belongs to (e.g. "backend-security"). */
  category: z.string(),

  /** Default severity level for findings produced by this rule. */
  severity: FindingSeverityEnum,

  /**
   * Contexts this rule applies to. Used by the engine to skip rules
   * that don't match the scan mode or detected project type.
   */
  applies_to: z.array(RuleAppliesToEnum),

  /**
   * External standards this rule maps to
   * (e.g. ["OWASP A01:2021", "CWE-798"]).
   */
  standards: z.array(z.string()),

  /**
   * When `true`, any finding from this rule automatically blocks the
   * merge / marks the scan as "blocked".
   */
  blocking: z.boolean(),

  /** Detailed description of what this rule checks and why. */
  description: z.string(),

  /**
   * Optional detection configuration. When absent, the rule is evaluated
   * programmatically by a dedicated scanner plugin rather than by pattern
   * matching.
   */
  detection: RuleDetectionSchema.optional(),

  /** Actionable recommendation shown when the rule triggers. */
  recommendation: z.string(),

  /** Whether this rule is active. Defaults to `true`. */
  enabled: z.boolean().default(true),
});

/** Fully-typed rule definition. */
export type Rule = z.infer<typeof RuleSchema>;
