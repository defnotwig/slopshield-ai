# Requirements Document

## Introduction

This feature transforms SlopShield AI from a manually triggered scan tool into an automated GitHub-integrated quality gate by registering a **GitHub App** that listens for pull request events and posts commit status checks. When a PR is opened, synchronized, or reopened, SlopShield automatically scans the head commit, posts a pending status check, and upon scan completion posts a success or failure status check alongside a PR comment summarizing findings.

This builds directly on the existing `github-repository-scanner` spec, which implemented the ingestion path for scanning public GitHub repositories by URL. The PR status checks feature reuses that ingestion pipeline but triggers it automatically via GitHub webhooks rather than manual URL submission. It also adds new capabilities: posting commit statuses via the GitHub Checks/Statuses API, posting PR comments, per-repository configuration of thresholds, and webhook security and rate-limiting.

The feature aligns with the platform's existing scoring model (90–100 passed, 80–89 warnings, 70–79 cleanup, 60–69 risky, 0–59 blocked) and auto-block conditions. The commit status check verdict maps directly to these bands: scores at or above the configured threshold produce a `success` status, scores below produce a `failure` status, and scan-in-progress produces a `pending` status.

### In Scope

- GitHub App registration and credential management (App ID, private key, webhook secret).
- Receiving and verifying webhook events (`pull_request` opened/synchronize/reopened, `installation` created/deleted).
- Triggering an automated SlopShield scan of the PR head commit on webhook receipt.
- Posting GitHub commit status checks (pending → success/failure) via the GitHub API.
- Posting a PR comment with scan summary (score, verdict, top issues, link to full report).
- Per-repository configuration: minimum score threshold, scan mode, auto-block toggle.
- Webhook HMAC signature verification (SHA-256).
- Rate-limiting webhook processing to prevent abuse.
- Graceful degradation: neutral status on scan failure or timeout.
- Installation and uninstallation lifecycle handling.

### Out of Scope

- GitHub Actions integration (this is a standalone GitHub App, not a GitHub Action).
- Scanning private repositories without the App's installation token (the App receives installation tokens automatically for installed repos).
- Supporting non-GitHub platforms (GitLab, Bitbucket) in this iteration.
- Manual re-trigger of PR checks from the SlopShield dashboard (future work).
- Inline PR review comments on specific lines (future work; this iteration posts a single summary comment).
- Branch protection rule configuration (users configure that in GitHub settings themselves).

### Dependencies and Assumptions

- The `github-repository-scanner` ingestion pipeline is operational (validates URLs, fetches repos, scans, scores, persists).
- The existing BullMQ scan-pipeline queue, ScanProcessor, ScoringService, and StandardsMapper are functional.
- The API has network egress to `api.github.com` for posting statuses and comments.
- The API is reachable from GitHub's webhook delivery IPs (publicly deployed or tunneled for development).
- A GitHub App has been registered in GitHub with the necessary permissions (statuses: write, pull_requests: write, contents: read) and subscribed to `pull_request` and `installation` events.

## Glossary

- **GitHub_App**: The registered GitHub App entity that SlopShield uses to receive webhook events and authenticate API calls to GitHub on behalf of installed repositories.
- **GitHub_App_Credentials**: The App ID, private key (PEM), and webhook secret used by the API to authenticate as the GitHub_App and verify incoming webhooks.
- **Installation**: A GitHub App installation on a user or organization account, granting the App access to specified repositories.
- **Installation_Token**: A short-lived token obtained by the GitHub_App for a specific Installation, used to authenticate GitHub API calls scoped to that installation's repositories.
- **Webhook_Event**: An HTTP POST request sent by GitHub to the API's webhook endpoint when a subscribed event occurs.
- **Webhook_Secret**: The shared secret configured in the GitHub_App used to compute HMAC-SHA256 signatures for verifying webhook authenticity.
- **PR_Event**: A `pull_request` webhook event with action `opened`, `synchronize`, or `reopened`.
- **Head_Commit**: The SHA of the latest commit on a pull request's head branch at the time of the PR_Event.
- **Commit_Status**: A GitHub commit status (pending, success, failure, error) posted via the GitHub Statuses API, displayed on the PR and usable in branch protection rules.
- **Status_Context**: The string identifier for SlopShield's commit status (e.g., `slopshield/scan`), distinguishing it from other status checks on the same commit.
- **PR_Comment**: A comment posted on the pull request via the GitHub Issues/PR Comments API containing the scan summary.
- **Scan_Threshold**: The minimum overall scan score required for a `success` commit status; configurable per repository, defaulting to 70.
- **Repository_Config**: Per-repository configuration stored in the database, including Scan_Threshold, Scan_Mode, and Auto_Block_Toggle.
- **Auto_Block_Toggle**: A per-repository setting that, when enabled, causes auto-block conditions to force a `failure` commit status regardless of score.
- **Webhook_Controller**: The API controller that receives, verifies, and dispatches incoming GitHub webhook events.
- **GitHub_App_Service**: The backend service responsible for managing installations, generating Installation_Tokens, posting Commit_Statuses, and posting PR_Comments.
- **PR_Scan_Job**: A ScanJob triggered by a PR_Event, linked to the pull request number, repository, and Head_Commit SHA.
- **Neutral_Status**: A commit status that neither blocks nor approves the PR, used when SlopShield cannot produce a definitive result (scan failure or timeout).
- **Scan_Mode**: The selected scope of a scan (`full`, `fast`, `security-only`, `frontend-only`, or `backend-only`), configurable per repository.
- **Rate_Limiter**: The mechanism that restricts the number of webhook-triggered scans processed within a time window to prevent resource exhaustion.

## Requirements

### Requirement 1: GitHub App Webhook Reception and Verification

**User Story:** As a platform operator, I want the API to securely receive and verify GitHub webhook events, so that only authentic GitHub-signed payloads trigger scan processing.

#### Acceptance Criteria

1. THE Webhook_Controller SHALL expose a dedicated HTTP POST endpoint for receiving GitHub webhook events.
2. WHEN a webhook request is received, THE Webhook_Controller SHALL verify the request's HMAC-SHA256 signature against the configured Webhook_Secret before processing the payload.
3. IF the HMAC-SHA256 signature verification fails, THEN THE Webhook_Controller SHALL reject the request with an HTTP 401 response and SHALL NOT process the payload.
4. IF the Webhook_Secret is not configured in the environment, THEN THE API SHALL reject all incoming webhook requests with an HTTP 503 response indicating webhook processing is unavailable.
5. WHEN a webhook request passes signature verification, THE Webhook_Controller SHALL parse the `X-GitHub-Event` header to determine the event type and dispatch accordingly.
6. WHEN a webhook event type is not subscribed or recognized, THE Webhook_Controller SHALL respond with an HTTP 200 acknowledgment and take no further action.
7. THE Webhook_Controller SHALL respond to GitHub within 10 seconds of receiving the webhook request by acknowledging receipt and processing asynchronously.

### Requirement 2: Pull Request Event Handling and Scan Triggering

**User Story:** As a developer, I want SlopShield to automatically scan my PR's latest commit when I open or push to a pull request, so that I get code quality feedback without manual intervention.

#### Acceptance Criteria

1. WHEN a PR_Event with action `opened`, `synchronize`, or `reopened` is received and verified, THE GitHub_App_Service SHALL extract the repository full name, pull request number, Head_Commit SHA, and head branch reference from the payload.
2. WHEN a valid PR_Event is received, THE GitHub_App_Service SHALL construct the Repository_URL from the payload's repository clone URL and the Head_Commit SHA.
3. WHEN a PR_Event is processed, THE GitHub_App_Service SHALL create a PR_Scan_Job with `sourceType` equal to `repository`, `sourceRef` set to the Repository_URL, and metadata linking the scan to the pull request number, repository full name, and Head_Commit SHA.
4. WHEN a PR_Scan_Job is created, THE GitHub_App_Service SHALL enqueue the scan on the existing `scan-pipeline` BullMQ queue.
5. IF a `synchronize` PR_Event is received for a pull request that already has a pending or queued PR_Scan_Job for a previous Head_Commit, THEN THE GitHub_App_Service SHALL cancel or supersede the previous scan and create a new PR_Scan_Job for the latest Head_Commit.
6. WHEN a PR_Event with an action other than `opened`, `synchronize`, or `reopened` is received, THE GitHub_App_Service SHALL acknowledge the event and take no scan action.
7. THE GitHub_App_Service SHALL use the Installation_Token scoped to the event's installation to fetch repository contents during the scan.

### Requirement 3: Commit Status Check Posting

**User Story:** As a team lead, I want SlopShield to post commit status checks on PRs reflecting the scan result, so that I can enforce merge policies using GitHub branch protection rules.

#### Acceptance Criteria

1. WHEN a PR_Scan_Job is created and enqueued, THE GitHub_App_Service SHALL post a `pending` Commit_Status on the Head_Commit with Status_Context `slopshield/scan` and a description indicating the scan is in progress.
2. WHEN a PR_Scan_Job completes with a score at or above the repository's Scan_Threshold, THE GitHub_App_Service SHALL post a `success` Commit_Status on the Head_Commit with a description including the score and verdict.
3. WHEN a PR_Scan_Job completes with a score below the repository's Scan_Threshold, THE GitHub_App_Service SHALL post a `failure` Commit_Status on the Head_Commit with a description including the score and verdict.
4. WHEN a PR_Scan_Job completes with a `blocked` Status_Result due to an Auto_Block_Condition AND the repository's Auto_Block_Toggle is enabled, THE GitHub_App_Service SHALL post a `failure` Commit_Status regardless of the numeric score.
5. WHEN a PR_Scan_Job completes with a `blocked` Status_Result AND the repository's Auto_Block_Toggle is disabled, THE GitHub_App_Service SHALL determine the Commit_Status based solely on whether the score meets the Scan_Threshold.
6. THE GitHub_App_Service SHALL include a `target_url` in the Commit_Status linking to the full scan report in the SlopShield Web_App.
7. THE GitHub_App_Service SHALL use the Installation_Token to authenticate Commit_Status API calls to GitHub.

### Requirement 4: PR Comment with Scan Summary

**User Story:** As a developer, I want SlopShield to post a comment on my PR with a summary of the scan findings, so that I can quickly see the score, verdict, and top issues without leaving GitHub.

#### Acceptance Criteria

1. WHEN a PR_Scan_Job completes successfully, THE GitHub_App_Service SHALL post a PR_Comment on the associated pull request containing the overall score, Status_Result verdict, and a count of findings by severity.
2. WHEN the scan produces findings, THE PR_Comment SHALL include the top 5 highest-severity findings with their title, severity, and category.
3. THE PR_Comment SHALL include a link to the full scan report in the SlopShield Web_App.
4. WHEN the scan produces findings mapped to standards, THE PR_Comment SHALL include the most relevant Standard_Reference identifiers for the top findings.
5. WHEN a `synchronize` event triggers a new scan for the same pull request, THE GitHub_App_Service SHALL update the existing SlopShield PR_Comment rather than posting a duplicate comment.
6. IF posting the PR_Comment fails due to a GitHub API error, THEN THE GitHub_App_Service SHALL log the failure and SHALL NOT fail the overall scan workflow.
7. THE GitHub_App_Service SHALL use the Installation_Token to authenticate PR_Comment API calls to GitHub.

### Requirement 5: Per-Repository Configuration

**User Story:** As a team lead, I want to configure SlopShield's behavior per repository, so that different projects can have different minimum score thresholds and scan modes appropriate to their risk profile.

#### Acceptance Criteria

1. THE API SHALL store a Repository_Config record per installed repository, containing the Scan_Threshold, Scan_Mode, and Auto_Block_Toggle.
2. WHEN a Repository_Config does not exist for a repository receiving a PR_Event, THE GitHub_App_Service SHALL apply default values: Scan_Threshold of 70, Scan_Mode of `full`, and Auto_Block_Toggle enabled.
3. WHEN an authenticated admin or repository owner updates a Repository_Config via the API, THE API SHALL validate that Scan_Threshold is an integer between 0 and 100 inclusive.
4. WHEN an authenticated admin or repository owner updates a Repository_Config via the API, THE API SHALL validate that Scan_Mode is one of the allowed values: `full`, `fast`, `security-only`, `frontend-only`, or `backend-only`.
5. WHEN a PR_Scan_Job is created, THE GitHub_App_Service SHALL read the Repository_Config for the target repository and apply the configured Scan_Mode to the scan.
6. WHEN a PR_Scan_Job completes, THE GitHub_App_Service SHALL compare the scan score against the Repository_Config's Scan_Threshold to determine the Commit_Status.
7. WHEN a Repository_Config is updated, THE API SHALL record the change in the Audit_Log.

### Requirement 6: GitHub App Installation Lifecycle

**User Story:** As an organization admin, I want SlopShield to handle GitHub App installation and uninstallation events, so that the system correctly tracks which repositories are covered and cleans up when access is revoked.

#### Acceptance Criteria

1. WHEN an `installation` webhook event with action `created` is received and verified, THE GitHub_App_Service SHALL persist the installation ID, account (user or organization), and the list of granted repository references.
2. WHEN an `installation` webhook event with action `deleted` is received and verified, THE GitHub_App_Service SHALL mark the installation as inactive and stop processing PR_Events for its repositories.
3. WHEN an installation is marked inactive, THE GitHub_App_Service SHALL retain historical scan data and Repository_Config records for audit purposes rather than deleting them.
4. WHEN an `installation_repositories` webhook event indicates repositories were added, THE GitHub_App_Service SHALL update the installation's repository list to include the newly granted repositories.
5. WHEN an `installation_repositories` webhook event indicates repositories were removed, THE GitHub_App_Service SHALL stop processing PR_Events for the removed repositories.
6. IF a PR_Event is received for a repository whose installation is inactive or not found, THEN THE GitHub_App_Service SHALL acknowledge the webhook and take no scan action.
7. WHEN an installation event is processed, THE GitHub_App_Service SHALL record the event in the Audit_Log.

### Requirement 7: Graceful Degradation on Scan Failure or Timeout

**User Story:** As a developer, I want SlopShield to post a neutral status if the scan fails or times out, so that a broken scanner never blocks my PR indefinitely.

#### Acceptance Criteria

1. IF a PR_Scan_Job fails due to an internal error during any scan stage, THEN THE GitHub_App_Service SHALL post a Neutral_Status on the Head_Commit with a description indicating the scan could not be completed.
2. IF a PR_Scan_Job does not complete within a configurable scan timeout period, THEN THE GitHub_App_Service SHALL cancel the scan, post a Neutral_Status on the Head_Commit, and record the timeout reason.
3. THE Neutral_Status SHALL use the GitHub `error` status state with a description that distinguishes it from a deliberate `failure` verdict.
4. WHEN a Neutral_Status is posted, THE GitHub_App_Service SHALL include a `target_url` linking to the scan details page showing the failure or timeout reason.
5. IF the GitHub API call to post a Commit_Status fails, THEN THE GitHub_App_Service SHALL retry the status posting up to 3 times with exponential backoff before logging the failure.
6. IF all retry attempts to post a Commit_Status fail, THEN THE GitHub_App_Service SHALL log the failure as an error and SHALL NOT leave the PR in a permanent `pending` state without operator visibility.
7. WHEN a scan timeout or failure triggers a Neutral_Status, THE GitHub_App_Service SHALL record the event in the Audit_Log for operator visibility.

### Requirement 8: Webhook Processing Rate Limiting

**User Story:** As a platform operator, I want webhook processing to be rate-limited, so that a burst of PR events or a replay attack cannot exhaust scan worker capacity.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL enforce a configurable maximum number of webhook-triggered scans per installation within a configurable time window.
2. WHEN the number of webhook-triggered scans for an installation exceeds the rate limit within the time window, THE Webhook_Controller SHALL respond with an HTTP 429 response for subsequent webhook events from that installation.
3. THE Rate_Limiter SHALL enforce a configurable global maximum number of concurrent webhook-triggered scans across all installations.
4. IF the global concurrent scan limit is reached, THEN THE Webhook_Controller SHALL queue the webhook event for deferred processing rather than rejecting it, up to a configurable queue depth.
5. IF the deferred processing queue is full, THEN THE Webhook_Controller SHALL respond with an HTTP 429 response.
6. WHEN a webhook event is rate-limited or deferred, THE Webhook_Controller SHALL log the event including the installation ID and repository.
7. THE Rate_Limiter SHALL NOT rate-limit `installation` lifecycle events, only `pull_request` scan-triggering events.

### Requirement 9: Installation Token Management

**User Story:** As a platform operator, I want the system to securely manage GitHub App authentication, so that API calls to GitHub use properly scoped, short-lived tokens and credentials are never exposed.

#### Acceptance Criteria

1. WHEN the API needs to make GitHub API calls for a specific installation, THE GitHub_App_Service SHALL generate a JSON Web Token (JWT) signed with the GitHub_App's private key and exchange it for an Installation_Token via the GitHub API.
2. THE GitHub_App_Service SHALL cache Installation_Tokens until they are within 5 minutes of expiration and refresh them proactively.
3. THE GitHub_App_Service SHALL store the GitHub_App private key only in the environment configuration and SHALL NOT persist it in the database or expose it in API responses.
4. IF Installation_Token generation fails for an installation, THEN THE GitHub_App_Service SHALL post a Neutral_Status on the Head_Commit indicating an authentication error and SHALL log the failure.
5. THE GitHub_App_Service SHALL scope Installation_Token requests to the minimum permissions required: `statuses:write`, `pull_requests:write`, and `contents:read`.
6. WHEN the API starts, THE API SHALL validate that the GitHub_App_Credentials (App ID, private key, webhook secret) are present if the GitHub App feature is enabled, and SHALL log a startup warning if they are absent.

### Requirement 10: Scan Results Integration with Existing Pipeline

**User Story:** As a developer, I want PR-triggered scans to produce the same quality results as manually triggered repository scans, so that the automated checks are consistent with the full SlopShield analysis.

#### Acceptance Criteria

1. WHEN a PR_Scan_Job is processed by the Scan_Pipeline, THE Scan_Pipeline SHALL run the same classify, scan, AI review, score, and report stages as a manually triggered repository scan.
2. WHEN findings are produced for a PR_Scan_Job, THE Standards_Mapper SHALL map findings to Standard_References identically to a manual repository scan.
3. WHEN scoring completes for a PR_Scan_Job, THE Scoring_Service SHALL apply the same scoring algorithm, category weights, and Auto_Block_Conditions as a manual repository scan.
4. WHEN a PR_Scan_Job completes, THE Scan_Pipeline SHALL persist the scan results so they are accessible through the existing `GET /scans/:id` and `GET /scans/:id/findings` endpoints.
5. WHEN a PR_Scan_Job completes, THE Scan_Pipeline SHALL include the pull request number, repository full name, and Head_Commit SHA in the persisted ScanJob metadata.
6. WHILE a PR_Scan_Job is processing, THE Scan_Pipeline SHALL emit Socket.IO progress events so that the Web_App can display real-time scan progress for PR-triggered scans.

### Requirement 11: Environment Configuration for GitHub App

**User Story:** As a platform operator, I want GitHub App credentials and feature toggles managed through environment variables, so that the App can be enabled or disabled without code changes.

#### Acceptance Criteria

1. WHERE the GitHub App feature is enabled, THE API SHALL require the following environment variables: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_WEBHOOK_SECRET`.
2. IF any required GitHub App environment variable is missing when the feature is enabled, THEN THE API SHALL log an error at startup and disable GitHub App webhook processing without crashing.
3. WHERE a `GITHUB_APP_ENABLED` environment variable is set to `false`, THE API SHALL not register the webhook endpoint and SHALL skip all GitHub App processing.
4. THE API SHALL support a `GITHUB_APP_SCAN_TIMEOUT` environment variable specifying the maximum time in seconds for a PR-triggered scan before timeout, defaulting to 300 seconds.
5. THE API SHALL support a `GITHUB_APP_RATE_LIMIT_PER_INSTALLATION` environment variable specifying the maximum webhook-triggered scans per installation per hour, defaulting to 60.
6. THE API SHALL support a `GITHUB_APP_GLOBAL_CONCURRENT_SCANS` environment variable specifying the maximum concurrent PR-triggered scans, defaulting to 10.
7. WHEN the Readiness_Endpoint is requested, THE API SHALL report the GitHub App integration status as `configured`, `skipped`, or `error`.
