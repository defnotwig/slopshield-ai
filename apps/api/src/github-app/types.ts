/**
 * Type definitions and constants for the GitHub App integration module.
 *
 * Covers webhook event payload interfaces, status/comment posting params,
 * scan result summaries, rate limiting, and scan mode configuration.
 */

// ---------------------------------------------------------------------------
// Event types and constants
// ---------------------------------------------------------------------------

/** Recognized GitHub webhook event types dispatched by the WebhookController. */
export type GitHubEventType =
  | 'pull_request'
  | 'installation'
  | 'installation_repositories';

/** PR event actions that trigger a scan. */
export const SCAN_TRIGGERING_ACTIONS = ['opened', 'synchronize', 'reopened'] as const;

/** Type derived from the triggering actions tuple. */
export type ScanTriggeringAction = (typeof SCAN_TRIGGERING_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Scan mode
// ---------------------------------------------------------------------------

/** Allowed scan modes for repository configuration. */
export type ScanMode = 'full' | 'fast' | 'security-only' | 'frontend-only' | 'backend-only';

/** Array of all allowed scan modes for validation. */
export const ALLOWED_SCAN_MODES: ScanMode[] = [
  'full',
  'fast',
  'security-only',
  'frontend-only',
  'backend-only',
];

// ---------------------------------------------------------------------------
// GitHub API interaction params
// ---------------------------------------------------------------------------

/** Parameters for posting a commit status to GitHub. */
export interface PostStatusParams {
  installationId: number;
  owner: string;
  repo: string;
  sha: string;
  state: 'pending' | 'success' | 'failure' | 'error';
  description: string;
  targetUrl: string;
  /** Always 'slopshield/scan'. */
  context: string;
}

/** Parameters for posting or updating a PR comment on GitHub. */
export interface PostCommentParams {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  /** If set, updates an existing comment instead of creating a new one. */
  existingCommentId?: number;
}

// ---------------------------------------------------------------------------
// Scan result summary
// ---------------------------------------------------------------------------

/** Summary data used to build PR comments after scan completion. */
export interface ScanResultSummary {
  scanId: string;
  overallScore: number;
  statusResult: string;
  findings: Array<{
    title: string;
    severity: string;
    category: string;
    standardReference?: string;
  }>;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  reportUrl: string;
}

// ---------------------------------------------------------------------------
// Commit status posting result
// ---------------------------------------------------------------------------

/** Result of attempting to post a commit status to GitHub. */
export interface PostStatusResult {
  /** Whether the status was successfully posted. */
  success: boolean;
  /** If failed, the reason for the failure. */
  failureReason?: 'token-generation-failed' | 'api-error-after-retries';
  /** Human-readable error message on failure. */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Result of a rate-limit check for webhook-triggered scans. */
export interface RateLimitResult {
  allowed: boolean;
  reason?: 'per-installation' | 'global-limit' | 'queue-full';
}

// ---------------------------------------------------------------------------
// Webhook event payload interfaces
// ---------------------------------------------------------------------------

/** Relevant fields from a GitHub `pull_request` webhook payload. */
export interface PullRequestEventPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    head: {
      sha: string;
      ref: string;
    };
  };
  repository: {
    full_name: string;
    clone_url: string;
    owner: {
      login: string;
    };
    name: string;
  };
  installation: {
    id: number;
  };
}

/** Relevant fields from a GitHub `installation` webhook payload. */
export interface InstallationEventPayload {
  action: 'created' | 'deleted';
  installation: {
    id: number;
    account: {
      login: string;
      type: string; // "Organization" | "User"
    };
  };
  repositories?: Array<{
    full_name: string;
  }>;
}

/** Relevant fields from a GitHub `installation_repositories` webhook payload. */
export interface InstallationReposEventPayload {
  action: 'added' | 'removed';
  installation: {
    id: number;
  };
  repositories_added?: Array<{
    full_name: string;
  }>;
  repositories_removed?: Array<{
    full_name: string;
  }>;
}
