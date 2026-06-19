import { z } from 'zod';
import { ScanStatusResultEnum } from './scan.schema.js';

// ---------------------------------------------------------------------------
// Lark Card Action
// ---------------------------------------------------------------------------

/**
 * Allowed interactive actions on a Lark scan notification card.
 * Each action maps to a backend handler that executes the requested
 * operation and updates the card in-place.
 */
export const LarkCardActionEnum = z.enum([
  'view-report',
  'create-tasks',
  'generate-fix-plan',
  'request-tl-review',
  'approve',
]);

/** TypeScript union for Lark card actions. */
export type LarkCardAction = z.infer<typeof LarkCardActionEnum>;

/**
 * Payload received when a user clicks an interactive button on a
 * SlopShield Lark notification card. Validated by the Lark webhook
 * handler before dispatching to the appropriate service.
 */
export const LarkCardActionSchema = z.object({
  /** Which action button was clicked. */
  action: LarkCardActionEnum,

  /** The scan this action relates to. */
  scanId: z.string(),

  /** The Lark user who performed the action (may be absent for system actions). */
  userId: z.string().optional(),
});

/** Typed Lark card action payload. */
export type LarkCardActionPayload = z.infer<typeof LarkCardActionSchema>;

// ---------------------------------------------------------------------------
// Lark Scan Summary
// ---------------------------------------------------------------------------

/**
 * Schema for the top-finding entries embedded in a Lark scan summary card.
 */
export const LarkTopFindingSchema = z.object({
  /** Short finding title. */
  title: z.string(),

  /** Severity label (e.g. "critical", "high"). */
  severity: z.string(),
});

/** Typed top-finding entry. */
export type LarkTopFinding = z.infer<typeof LarkTopFindingSchema>;

/**
 * Summary payload sent to Lark when a scan completes. Used to render
 * the interactive notification card in the team's Lark group chat.
 */
export const LarkScanSummarySchema = z.object({
  /** Unique scan identifier. */
  scanId: z.string(),

  /** Repository name or source identifier. */
  repository: z.string(),

  /** Pull request number (if scan was triggered by a PR webhook). */
  prNumber: z.string().optional(),

  /** Display name or email of the user who triggered the scan. */
  author: z.string(),

  /** Overall quality score (0–100). */
  score: z.number().min(0).max(100),

  /** Final pass/fail verdict. */
  status: ScanStatusResultEnum,

  /** Top findings to highlight in the card (max 5 recommended). */
  topFindings: z.array(LarkTopFindingSchema),

  /** Full URL to the SlopShield scan report page. */
  reportUrl: z.string().url(),
});

/** Fully-typed Lark scan summary payload. */
export type LarkScanSummary = z.infer<typeof LarkScanSummarySchema>;
