# Implementation Plan: GitHub PR Status Checks

## Overview

This plan implements the GitHub App integration for SlopShield AI, transforming it from a manually triggered scanner into an automated quality gate. The implementation is broken into incremental steps: data models and types first, then pure utility functions, then services, then the controller and wiring, and finally integration testing. Each step builds on the previous and ends with fully wired, testable code.

## Tasks

- [x] 1. Set up database models and type definitions
  - [x] 1.1 Create Prisma schema additions for GitHub App models
    - Add `GitHubInstallation`, `RepositoryConfig`, and `PrScanMetadata` models to `apps/api/prisma/schema.prisma`
    - Add `triggerType` field usage documentation comment to existing `ScanJob` model
    - Run `prisma migrate dev` to generate migration
    - _Requirements: 6.1, 5.1, 2.3, 10.5_

  - [x] 1.2 Create TypeScript type definitions and constants
    - Create `apps/api/src/github-app/types.ts` with all event payload interfaces, `PostStatusParams`, `PostCommentParams`, `ScanResultSummary`, `RateLimitResult`, `ScanMode`, `ALLOWED_SCAN_MODES`, `SCAN_TRIGGERING_ACTIONS`, and `GitHubEventType`
    - _Requirements: 2.1, 5.4_

  - [x] 1.3 Create environment configuration validation
    - Create `apps/api/src/github-app/github-app.config.ts` with Zod schema validating `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_ENABLED`, `GITHUB_APP_SCAN_TIMEOUT`, `GITHUB_APP_RATE_LIMIT_PER_INSTALLATION`, `GITHUB_APP_GLOBAL_CONCURRENT_SCANS`
    - Apply defaults: timeout 300s, rate limit 60/hour, concurrent scans 10
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 2. Implement webhook signature verification
  - [x] 2.1 Implement `verifyWebhookSignature` and `computeWebhookSignature`
    - Create `apps/api/src/github-app/webhook-signature.ts`
    - Use `crypto.createHmac('sha256', secret)` with `timingSafeEqual` for constant-time comparison
    - Handle `sha256=` prefix format
    - _Requirements: 1.2, 1.3_

  - [x] 2.2 Write property test for webhook signature verification
    - **Property 1: Webhook HMAC-SHA256 verification correctness**
    - **Validates: Requirements 1.2, 1.3**
    - Create `apps/api/src/github-app/webhook-signature.property.spec.ts`
    - Test round-trip: compute then verify returns true for arbitrary payloads and secrets
    - Test mutation: flipped bytes in payload or wrong secret returns false

- [x] 3. Implement GitHub Token Service
  - [x] 3.1 Implement `GitHubTokenService`
    - Create `apps/api/src/github-app/github-token.service.ts`
    - Implement `generateAppJwt()` using `jsonwebtoken` with RS256 signing, `iss=APP_ID`, `iat=now-60s`, `exp=now+10min`
    - Implement `getInstallationToken(installationId)` with in-memory cache, 5-min-before-expiry refresh logic, and GitHub API exchange
    - Implement `validateCredentials()` returning `{ status: 'configured' | 'skipped' | 'error', message? }`
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 11.7_

  - [x] 3.2 Write property test for JWT generation
    - **Property 14: JWT generation correctness**
    - **Validates: Requirements 9.1**
    - Create `apps/api/src/github-app/jwt-generation.property.spec.ts`
    - Test that generated JWT has correct `iss`, `iat` within 60s of now, `exp` within 10min of `iat`

  - [x] 3.3 Write property test for token cache boundary
    - **Property 15: Token cache respects expiry boundary**
    - **Validates: Requirements 9.2**
    - Create `apps/api/src/github-app/token-cache.property.spec.ts`
    - Test cached token returned when >5min until expiry, fresh fetch triggered when <=5min

  - [x] 3.4 Write property test for readiness status determination
    - **Property 16: Readiness endpoint reports correct GitHub App status**
    - **Validates: Requirements 11.7**
    - Create `apps/api/src/github-app/readiness-status.property.spec.ts`
    - Test all environment state combinations → correct status string

- [x] 4. Implement Repository Config Service
  - [x] 4.1 Implement `RepositoryConfigService`
    - Create `apps/api/src/github-app/repository-config.service.ts`
    - Implement `getConfig(repoFullName)` returning defaults when no record exists
    - Implement `upsertConfig(repoFullName, update)` with validation and audit log recording
    - Implement `validateThreshold(value)` accepting integers in [0, 100]
    - Implement `validateScanMode(value)` accepting only allowed scan mode strings
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 4.2 Write property test for repository config validation
    - **Property 12: Repository config validation**
    - **Validates: Requirements 5.3, 5.4**
    - Create `apps/api/src/github-app/repo-config-validation.property.spec.ts`
    - Test `validateThreshold` accepts [0,100] integers, rejects everything else
    - Test `validateScanMode` accepts only the 5 allowed strings

  - [x] 4.3 Write property test for default config application
    - **Property 13: Default config application**
    - **Validates: Requirements 5.2**
    - Test that any repo without config returns threshold=70, mode=full, autoBlock=true

- [x] 5. Implement Webhook Rate Limiter
  - [x] 5.1 Implement `WebhookRateLimiter`
    - Create `apps/api/src/github-app/webhook-rate-limiter.service.ts`
    - Implement Redis-backed sliding window per installation (default 60/hour)
    - Implement global concurrent scan semaphore (default 10)
    - Implement `checkAllowed(installationId)` returning `{ allowed, reason? }`
    - Implement `recordScanStart/recordScanEnd` for global concurrency tracking
    - Implement `isExempt(eventType)` exempting installation lifecycle events
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 5.2 Write property test for per-installation rate limiting
    - **Property 11: Per-installation rate limiting**
    - **Validates: Requirements 8.1, 8.2, 8.7**
    - Create `apps/api/src/github-app/rate-limiter.property.spec.ts`
    - Test that first N events allowed, subsequent rejected; lifecycle events never limited

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement GitHubAppService core logic
  - [x] 7.1 Implement `determineCommitStatus` pure function
    - Create `apps/api/src/github-app/github-app.service.ts`
    - Implement score-vs-threshold comparison with auto-block override logic
    - Return `'success'` when score >= threshold and not blocked, `'failure'` when score < threshold or blocked with autoBlock enabled, score-based when blocked with autoBlock disabled
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [x] 7.2 Write property test for score-to-status mapping
    - **Property 4: Score-to-status mapping**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 5.6**
    - Create `apps/api/src/github-app/commit-status-mapping.property.spec.ts`
    - Test all combinations of score/threshold/statusResult/autoBlock

  - [x] 7.3 Implement `buildPrCommentBody` pure function
    - Build markdown comment body with overall score, verdict, severity counts, top 5 findings with title/severity/category/standardReference, and report link
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 7.4 Write property test for PR comment builder
    - **Property 6: PR comment completeness**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    - Create `apps/api/src/github-app/pr-comment-builder.property.spec.ts`
    - Test output contains score, verdict, counts, link, and top findings when present

  - [x] 7.5 Implement `postCommitStatus` with retry logic
    - 3 attempts, exponential backoff (1s, 2s, 4s)
    - Include `target_url` pointing to full scan report
    - Use `Installation_Token` for auth
    - Log and record in audit log on final failure
    - _Requirements: 3.6, 3.7, 7.5, 7.6_

  - [x] 7.6 Implement `postOrUpdatePrComment`
    - Post new comment or update existing (tracked via `PrScanMetadata.commentId`)
    - Non-blocking: log failure, do not fail scan workflow
    - _Requirements: 4.5, 4.6, 4.7_

  - [x] 7.7 Implement `handlePullRequestEvent`
    - Verify installation is active
    - Check rate limit
    - Read repository config (or apply defaults)
    - Cancel/supersede any existing pending scan for same PR
    - Create `ScanJob` with `triggerType: "github-pr"` and `sourceRef` containing repo URL + SHA
    - Create `PrScanMetadata` record
    - Post `pending` commit status
    - Enqueue on `scan-pipeline` BullMQ queue
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1_

  - [x] 7.8 Implement `handleInstallationEvent`
    - Persist installation on `created`, mark inactive on `deleted`
    - Retain historical data on deletion
    - Record events in audit log
    - _Requirements: 6.1, 6.2, 6.3, 6.7_

  - [x] 7.9 Implement `handleInstallationRepositoriesEvent`
    - Update installation's repository list on add/remove
    - Stop processing PR events for removed repos
    - _Requirements: 6.4, 6.5_

  - [x] 7.10 Implement `onScanCompleted` event handler
    - Listen to `scan.completed` NestJS event
    - Load `PrScanMetadata`; return early if not a PR scan
    - Load `RepositoryConfig`
    - Call `determineCommitStatus`
    - Post commit status (handle failure/timeout → error status)
    - Build and post/update PR comment
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 7.1, 7.2, 7.3, 7.4, 7.7_

- [x] 8. Implement WebhookController and wire module
  - [x] 8.1 Implement `WebhookController`
    - Create `apps/api/src/github-app/webhook.controller.ts`
    - Expose `POST /webhooks/github` endpoint
    - Verify HMAC signature; return 401 on failure, 503 if secret not configured
    - Parse `X-GitHub-Event` header, dispatch to appropriate service method
    - Acknowledge unrecognized events with 200
    - Respond within 10s by dispatching async processing
    - Apply rate limiting for scan-triggering events; return 429 when exceeded
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 8.2, 8.5_

  - [x] 8.2 Write property test for event dispatch routing
    - **Property 2: Event dispatch routing correctness**
    - **Validates: Requirements 1.5, 1.6, 2.6**
    - Create `apps/api/src/github-app/event-dispatch.property.spec.ts`
    - Test recognized event types dispatch correctly, unrecognized events acknowledged with no side effects

  - [x] 8.3 Create `GitHubAppModule` and register all providers
    - Create `apps/api/src/github-app/github-app.module.ts`
    - Register WebhookController, GitHubAppService, GitHubTokenService, WebhookRateLimiter, RepositoryConfigService
    - Conditionally register based on `GITHUB_APP_ENABLED`
    - _Requirements: 11.3_

  - [x] 8.4 Modify `ScanProcessor` to emit `scan.completed` event
    - Add NestJS EventEmitter `emit('scan.completed', { scanId })` after scoring stage completes
    - Minimal change to existing code
    - _Requirements: 10.1, 10.4_

  - [x] 8.5 Wire `GitHubAppModule` into the root `AppModule`
    - Import the module conditionally
    - Ensure raw body parsing is enabled for the webhook endpoint
    - Update readiness endpoint to include GitHub App status
    - _Requirements: 11.7_

- [x] 9. Implement scan timeout and graceful degradation
  - [x] 9.1 Implement scan timeout handling
    - Add BullMQ job timeout based on `GITHUB_APP_SCAN_TIMEOUT` for PR-triggered scans
    - On timeout: cancel scan, post `error` commit status with timeout description, record in audit log
    - _Requirements: 7.2, 7.7_

  - [x] 9.2 Implement token generation failure handling
    - When `getInstallationToken` fails: post `error` status indicating auth error, log failure
    - _Requirements: 9.4_

  - [x] 9.3 Write property test for scan failure produces neutral/error status
    - **Property 10: Scan failure produces neutral/error status**
    - **Validates: Requirements 7.1, 7.3**
    - Create `apps/api/src/github-app/scan-failure-status.property.spec.ts`
    - Test that any failed PR scan posts `error` state (not `failure`) with distinguishing description

- [x] 10. Implement Repository Config API endpoint
  - [x] 10.1 Create REST endpoint for Repository Config CRUD
    - Create `apps/api/src/github-app/repository-config.controller.ts`
    - `GET /repositories/:repoFullName/config` — returns config or defaults
    - `PUT /repositories/:repoFullName/config` — updates config with validation
    - Require authenticated admin or repository owner
    - Record changes in audit log
    - _Requirements: 5.3, 5.4, 5.7_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Integration testing and final wiring
  - [x] 12.1 Write integration tests for webhook → scan → status flow
    - Create `apps/api/src/github-app/github-app.integration.spec.ts`
    - Test end-to-end: webhook receipt → signature verification → scan enqueue → completion event → status posted
    - Test installation lifecycle: created → repos queryable → PR events accepted
    - Test supersession: two synchronize events → first scan cancelled
    - Test rate limiting: exceed limit → 429, window expires → allowed
    - _Requirements: 1.7, 2.4, 2.5, 3.1, 6.1, 6.2, 8.1, 8.2_

  - [x] 12.2 Write unit tests for WebhookController edge cases
    - Create `apps/api/src/github-app/webhook.controller.spec.ts`
    - Test missing signature → 401, unconfigured secret → 503, malformed body → 400
    - Test unrecognized event → 200 with no processing
    - _Requirements: 1.2, 1.3, 1.4, 1.6_

  - [x] 12.3 Write unit tests for GitHubAppService
    - Create `apps/api/src/github-app/github-app.service.spec.ts`
    - Test installation token failure → error status
    - Test PR comment failure → scan continues
    - Test inactive installation → no scan created
    - _Requirements: 4.6, 6.6, 9.4_

  - [x] 12.4 Update `.env.example` with GitHub App environment variables
    - Add `GITHUB_APP_ENABLED`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_SCAN_TIMEOUT`, `GITHUB_APP_RATE_LIMIT_PER_INSTALLATION`, `GITHUB_APP_GLOBAL_CONCURRENT_SCANS`
    - _Requirements: 11.1, 11.4, 11.5, 11.6_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript (NestJS) as specified in the design
- `fast-check` is already a dev dependency and is used for property-based tests
- The existing scan pipeline (`ScanProcessor`, `ScoringService`, `StandardsMapper`) is unchanged; only a `scan.completed` event emission is added

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "3.3", "3.4", "4.2", "4.3", "5.2"] },
    { "id": 3, "tasks": ["7.1", "7.3"] },
    { "id": 4, "tasks": ["7.2", "7.4", "7.5", "7.6"] },
    { "id": 5, "tasks": ["7.7", "7.8", "7.9"] },
    { "id": 6, "tasks": ["7.10", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 8, "tasks": ["8.5", "9.1", "9.2"] },
    { "id": 9, "tasks": ["9.3", "10.1"] },
    { "id": 10, "tasks": ["12.1", "12.2", "12.3", "12.4"] }
  ]
}
```
