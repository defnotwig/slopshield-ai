import { FindingCategory } from "../schemas/finding.schema.js";

/**
 * Weights assigned to each scan category when calculating the weighted overall score.
 * Sums up to 1.0 (100%).
 *
 * Weights:
 * - security: 25% (highest priority, critical risk)
 * - maintainability: 20% (code smells, size)
 * - architecture: 20% (boundaries, imports)
 * - testability: 15% (test coverage)
 * - frontend: 10% (a11y and UI metrics)
 * - reliability: 5% (error handling resilience)
 * - documentation: 5% (inline documentation)
 */
export const CATEGORY_WEIGHTS: Record<FindingCategory, number> = {
  "backend-security": 0.125, // security split between frontend/backend
  "frontend-security": 0.125,
  "backend-architecture": 0.1, // architecture split
  "frontend-architecture": 0.1,
  maintainability: 0.2,
  testability: 0.15,
  accessibility: 0.1, // Maps to "frontend" accessibility
  reliability: 0.05,
  documentation: 0.05,
  general: 0.0, // General findings carry no weight deductions on their own category
};

/**
 * User-facing display labels for each finding category.
 */
export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  "backend-security": "Backend Security",
  "frontend-security": "Frontend Security",
  "backend-architecture": "Backend Architecture",
  "frontend-architecture": "Frontend Architecture",
  maintainability: "Code Maintainability",
  testability: "Code Testability",
  accessibility: "Accessibility & UX",
  reliability: "System Reliability",
  documentation: "Code Documentation",
  general: "General Findings",
};

/**
 * Lucide icon names corresponding to each finding category.
 * Used by the frontend navigation and category scorecards.
 */
export const CATEGORY_ICONS: Record<FindingCategory, string> = {
  "backend-security": "ShieldAlert",
  "frontend-security": "ShieldCheck",
  "backend-architecture": "Cpu",
  "frontend-architecture": "Layers",
  maintainability: "Wrench",
  testability: "TestTube",
  accessibility: "Accessibility",
  reliability: "Activity",
  documentation: "FileText",
  general: "Info",
};

/**
 * How each derivation rule combines its source category raw scores into a
 * single displayed score.
 *
 * - `direct`: the displayed score equals the single source category's raw score.
 * - `mean`: the displayed score is the arithmetic mean of all source raw scores.
 */
export type CategoryScoreDerivation = "direct" | "mean";

/**
 * Describes how a single displayed/persisted category score is derived from the
 * raw {@link FindingCategory} scores produced by the scanner pipeline.
 */
export interface CategoryScoreSemantic {
  /** The raw finding categories whose scores feed this displayed score. */
  sources: FindingCategory[];
  /** How the source raw scores are combined. */
  derivation: CategoryScoreDerivation;
  /** Human-readable explanation of the mapping. */
  description: string;
}

/**
 * Canonical, exported documentation of the category-score semantics shared
 * across the API persistence columns and the Web_App display labels (resolves
 * audit finding C1). This is the single source of truth that keeps the
 * `ScanJob.*Score` columns and the dashboard scorecards in agreement about how
 * the displayed categories relate to the raw {@link FindingCategory} scores.
 *
 * Semantics:
 * - `frontend` is sourced directly from the `accessibility` raw score.
 * - `security` is the mean of `backend-security` and `frontend-security`.
 * - `architecture` is the mean of `backend-architecture` and `frontend-architecture`.
 *
 * The remaining displayed categories map one-to-one onto their raw category.
 */
export const CATEGORY_SCORE_SEMANTICS = {
  frontend: {
    sources: ["accessibility"],
    derivation: "direct",
    description: "Frontend score is sourced from the accessibility raw score.",
  },
  security: {
    sources: ["backend-security", "frontend-security"],
    derivation: "mean",
    description:
      "Security score is the mean of the backend-security and frontend-security raw scores.",
  },
  architecture: {
    sources: ["backend-architecture", "frontend-architecture"],
    derivation: "mean",
    description:
      "Architecture score is the mean of the backend-architecture and frontend-architecture raw scores.",
  },
  maintainability: {
    sources: ["maintainability"],
    derivation: "direct",
    description: "Maintainability score maps directly to the maintainability raw score.",
  },
  testability: {
    sources: ["testability"],
    derivation: "direct",
    description: "Testability score maps directly to the testability raw score.",
  },
  reliability: {
    sources: ["reliability"],
    derivation: "direct",
    description: "Reliability score maps directly to the reliability raw score.",
  },
  documentation: {
    sources: ["documentation"],
    derivation: "direct",
    description: "Documentation score maps directly to the documentation raw score.",
  },
} as const satisfies Record<string, CategoryScoreSemantic>;

/** Displayed/persisted category-score keys documented by {@link CATEGORY_SCORE_SEMANTICS}. */
export type CategoryScoreKey = keyof typeof CATEGORY_SCORE_SEMANTICS;
