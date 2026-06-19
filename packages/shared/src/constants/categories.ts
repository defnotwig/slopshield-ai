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
