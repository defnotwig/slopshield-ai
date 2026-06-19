import { ScanStatusResult } from "../schemas/scan.schema.js";

export interface ScoreThreshold {
  min: number;
  max: number;
  status: ScanStatusResult;
  label: string;
  color: string;
  description: string;
}

/**
 * Threshold limits for assigning scan status results based on the overall score.
 */
export const SCORE_THRESHOLDS: ScoreThreshold[] = [
  {
    min: 90,
    max: 100,
    status: "passed",
    label: "Passed",
    color: "#22c55e", // Green-500
    description: "Code meets production quality standards.",
  },
  {
    min: 80,
    max: 89,
    status: "passed-with-warnings",
    label: "Passed with Warnings",
    color: "#84cc16", // Lime-500
    description: "Minor issues detected, but code is acceptable for merge.",
  },
  {
    min: 70,
    max: 79,
    status: "needs-cleanup",
    label: "Needs Cleanup",
    color: "#eab308", // Yellow-500
    description: "Several non-blocking issues require attention before merge.",
  },
  {
    min: 60,
    max: 69,
    status: "risky",
    label: "Risky",
    color: "#f97316", // Orange-500
    description: "Significant quality issues detected. Review recommended.",
  },
  {
    min: 0,
    max: 59,
    status: "blocked",
    label: "Blocked",
    color: "#ef4444", // Red-500
    description: "Critical or numerous issues prevent merging this code.",
  },
];

/**
 * Determines the status result verdict based on a given overall score.
 *
 * @param score The computed overall score (0-100)
 * @returns The associated ScanStatusResult status
 */
export function getScoreStatus(score: number): ScanStatusResult {
  const threshold = SCORE_THRESHOLDS.find(
    (t) => score >= t.min && score <= t.max,
  );
  return threshold ? threshold.status : "blocked";
}

/**
 * Retrieves the hex color code matching a given score threshold.
 *
 * @param score The overall score (0-100)
 * @returns The hex color string
 */
export function getScoreColor(score: number): string {
  const threshold = SCORE_THRESHOLDS.find(
    (t) => score >= t.min && score <= t.max,
  );
  return threshold ? threshold.color : "#ef4444";
}

/**
 * Retrieves the human-readable label matching a given score threshold.
 *
 * @param score The overall score (0-100)
 * @returns The display label
 */
export function getScoreLabel(score: number): string {
  const threshold = SCORE_THRESHOLDS.find(
    (t) => score >= t.min && score <= t.max,
  );
  return threshold ? threshold.label : "Blocked";
}
