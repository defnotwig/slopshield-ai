import { FindingSeverity } from '../schemas/finding.schema.js';

/**
 * Point deductions applied to each category score for findings of a given severity.
 * A category's score starts at 100 and findings deduct points up to a minimum score of 0.
 *
 * Deductions:
 * - critical: 25 points
 * - high: 10 points
 * - medium: 5 points
 * - low: 2 points
 * - info: 0.5 points
 */
export const SEVERITY_DEDUCTIONS: Record<FindingSeverity, number> = {
  critical: 25,
  high: 10,
  medium: 5,
  low: 2,
  info: 0.5,
};

/**
 * Canonical ordering of finding severities from most to least severe.
 * Used for sorting findings, computing lists, and prioritizing reviews.
 */
export const SEVERITY_ORDER: FindingSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

/**
 * Hex color values associated with each finding severity level.
 * Used in dashboards, reports, and Lark card UI.
 */
export const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: '#ef4444', // Red-500
  high: '#f97316',     // Orange-500
  medium: '#eab308',   // Yellow-500
  low: '#3b82f6',      // Blue-500
  info: '#6b7280',     // Gray-500
};
