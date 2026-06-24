import { z } from "zod";
import { FindingSeverityEnum, FindingCategoryEnum } from "./finding.schema.js";

// ---------------------------------------------------------------------------
// Custom Rule Schema — per-project user-defined scan rules
// ---------------------------------------------------------------------------

/**
 * A project-defined regex rule applied by the CustomRuleAnalyzer as an extra
 * pass after the built-in analyzers. Stored as JSON on `Project.customRules`.
 */
export const CustomRuleSchema = z.object({
  /** Stable id (uuid or slug) for the rule. */
  id: z.string().min(1),
  /** Human-readable rule name shown in findings + the rules UI. */
  name: z.string().min(1).max(120),
  /** Regex source applied per line of each matched file. */
  pattern: z.string().min(1).max(500),
  /** Optional regex flags (validated to a safe subset). */
  flags: z
    .string()
    .max(8)
    .regex(/^[gimsuy]*$/, "Only g,i,m,s,u,y flags are allowed")
    .optional(),
  /** Severity assigned to matches. */
  severity: FindingSeverityEnum,
  /** Category assigned to matches. */
  category: FindingCategoryEnum,
  /** Why-it-matters message shown on the finding. */
  message: z.string().min(1).max(500),
  /** Optional remediation recommendation. */
  recommendation: z.string().max(500).optional(),
  /** Whether a match should block the scan. */
  blocking: z.boolean().optional(),
  /**
   * Optional substring file filters; a file is scanned by this rule only if its
   * path contains at least one of these substrings (empty/absent = all files).
   */
  fileGlobs: z.array(z.string().max(120)).max(20).optional(),
  /** Disabled rules are skipped without being deleted. */
  enabled: z.boolean().optional(),
});

/** A single project-defined custom rule. */
export type CustomRule = z.infer<typeof CustomRuleSchema>;

/** The full set of custom rules attached to a project. */
export const CustomRuleListSchema = z.array(CustomRuleSchema).max(200);
export type CustomRuleList = z.infer<typeof CustomRuleListSchema>;
