# Requirements Document

## Introduction

This spec hardens **SlopShield AI** from a partly mock/demo system into a real, production-grade DevSecOps quality gate. It is **audit-first**: every requirement here traces back to evidence-based findings recorded in `.kiro/specs/production-grade-system/root-cause-audit.md`. The audit is the primary source of truth for what is broken and must be fixed; this document translates those findings into testable EARS requirements.

The live deployment already works at the API level. As verified in the audit, the backend on Render, Neon Postgres, Upstash Redis, authentication, CORS, and an end-to-end real GitHub repository scan (`octocat/Hello-World`, score 98, findings persisted) all function correctly. The remaining production gaps are concentrated in six areas: the **frontend↔API contract**, **session longevity**, **environment validation and readiness**, **scanner robustness on arbitrary repositories**, **Lark delivery truthfulness**, and **security hardening**.

These requirements are deliberately **incremental and evidence-driven**. They do not call for broad rewrites, and they must not introduce capabilities that contradict the existing architecture (NestJS API, Next.js Web_App, Prisma/Postgres, BullMQ scan workers, shared Zod schemas in `packages/shared`, and the existing scanner-plugin analyzers). Where the audit assigns a finding code (A1–A5, B1–B8, C1–C5), the corresponding requirement references that code so design and tasks remain traceable.

The audit-to-requirement mapping is summarized below for traceability:

| Audit finding | Requirement(s) |
| --- | --- |
| A1 (sourceType contract) | 3 |
| A2 (dashboard shapes) | 8 |
| A3 (refresh token) | 1 |
| A4 (env readiness) | 11 |
| A5 (analyzer robustness) | 5 |
| B1 (Lark status truth) | 9 |
| B2 (Lark card real data) | 9 |
| B3 (zip-slip / repo intake guards) | 4 |
| B4 (rate limiting) | 10 |
| B5 (audit logging) | 10 |
| B6 (prompt injection) | 6 |
| B7 (rerun endpoint) | 3, 8 |
| B8 (frontend states) | 2, 3, 8 |
| C1 (scoring semantics) | 7 |
| C4 (refresh secret guard) | 1, 11 |
| Live mode / mock policy | 2 |
| Testing & deployment readiness | 12 |

## Glossary

- **API**: The NestJS backend application (`apps/api`) exposing REST endpoints under `/api`, Socket.IO progress events, and the scan orchestration.
- **Web_App**: The Next.js frontend application (`apps/web`) that consumes the API and renders the dashboard, scan, and report surfaces.
- **Shared_Schemas**: The Zod schemas and shared types in `packages/shared` that define the contract between the API and the Web_App.
- **Scan_Worker**: The BullMQ `scan-pipeline` worker (`ScanProcessor`) that runs the fetching, classifying, scanning, ai-reviewing, scoring, reporting, and notifying stages.
- **Scanner_Orchestrator**: The component that runs the static analyzers (`FileClassifier`, `SecretAnalyzer`, `TypeScriptAnalyzer`, `ESLintAnalyzer`, `SemgrepAnalyzer`, and related analyzers) over a Scan_Directory.
- **Analyzer**: A single static-analysis plugin in `packages/scanner-plugins` (for example the TypeScript, ESLint, Semgrep, or Secret analyzer).
- **Analyzer_Status**: The recorded outcome of a single Analyzer on a scan, one of `ran`, `skipped`, or `failed`.
- **Scan_Directory**: The per-scan temporary directory (`temp-scans/{scanId}`) holding source files for a scan; cleaned up after processing.
- **GitHub_Ingestion_Service**: The backend component that validates a GitHub Repository_URL and fetches repository contents into the Scan_Directory.
- **Repository_URL**: An HTTPS URL identifying a public `github.com` repository, optionally with a branch or ref.
- **Scan_Mode**: The selected scope of a scan, one of `full`, `fast`, `security-only`, `frontend-only`, or `backend-only`.
- **AI_Reviewer**: The AI review component (`apps/api/src/ai-reviewer`) that, when configured with a Gemini key, augments findings and summaries.
- **Standards_Mapper**: The component that maps a Finding to one or more Standard_Reference identifiers (OWASP, CWE, NIST SSDF, ISO/IEC 25010, WCAG 2.2).
- **Standard_Reference**: A concrete external standard identifier (for example "OWASP A01:2021", "CWE-798", "WCAG 2.2 SC 1.1.1", "NIST SSDF", "ISO/IEC 25010") from the shared standards constants.
- **Scoring_Service**: The component that computes the overall score, per-category scores, and the Status_Result verdict.
- **Status_Result**: The scan verdict, one of `passed`, `passed-with-warnings`, `needs-cleanup`, `risky`, or `blocked`.
- **Auto_Block_Condition**: A condition from the shared auto-block constant that forces a `blocked` verdict regardless of overall score.
- **Finding**: A normalized issue carrying `severity`, `category`, `title`, `whyItMatters`, `recommendation`, `standardReferences`, `blocking`, `confidence`, `source`, `codeSnippet`, and `suggestedTests`.
- **ScanJob**: The Prisma `ScanJob` row recording `sourceType`, `sourceRef`, `status`, `statusResult`, scores, and timestamps.
- **Access_Token**: The short-lived JWT issued at login and sent on the `Authorization` header.
- **Refresh_Token**: The longer-lived token used to obtain a new Access_Token without re-authentication.
- **Live_Mode**: The Web_App runtime configuration (`NEXT_PUBLIC_API_MODE=live`) in which the Web_App uses only real API data.
- **Mock_Mode**: The Web_App runtime configuration (`NEXT_PUBLIC_API_MODE=mock`) in which the Web_App serves locally generated demo data.
- **Lark_Service**: The backend component that builds and delivers scan notification cards to a Lark/Feishu webhook and records delivery in the `LarkEvent` table.
- **Readiness_Endpoint**: The endpoint that reports per-integration configuration status (`configured | skipped | error`) without hard-failing boot.
- **Integration**: An optional external dependency, specifically Gemini (AI), GitHub token, and Lark.
- **Audit_Log**: A persisted record of a security-relevant action capturing actor, action, target, IP address, and timestamp.

## Requirements

### Requirement 1: Authentication and Session Longevity

**User Story:** As a returning user, I want my session to persist across the working day and refresh automatically, so that I am not forced to log in every fifteen minutes. *(Audit A3, C4)*

#### Acceptance Criteria

1. WHEN valid credentials are submitted to the login endpoint, THE API SHALL return an Access_Token and a Refresh_Token together with the authenticated user profile.
2. WHEN a registration request is submitted with a unique email and a valid password, THE API SHALL create the user, hash the password using Argon2, and return an Access_Token and a Refresh_Token.
3. THE API SHALL store user passwords only as Argon2 hashes and SHALL NOT store or return plaintext passwords.
4. WHEN a request is received at the current-user endpoint with a valid Access_Token, THE API SHALL return the authenticated user profile.
5. WHEN a logout request is received, THE API SHALL invalidate the associated Refresh_Token so that it can no longer be exchanged for a new Access_Token.
6. WHEN a valid Refresh_Token is presented to the refresh endpoint, THE API SHALL issue a new Access_Token.
7. IF an invalid, expired, or revoked Refresh_Token is presented to the refresh endpoint, THEN THE API SHALL reject the request with an HTTP 401 response.
8. WHEN login or registration succeeds in the Web_App, THE Web_App SHALL persist both the Access_Token and the Refresh_Token.
8a. IF token persistence fails in the Web_App due to a browser storage limitation or quota, THEN THE Web_App SHALL treat the login as failed and display an error rather than proceeding as authenticated.
9. WHEN an authenticated API request from the Web_App returns an HTTP 401 due to an expired Access_Token, THE Web_App SHALL attempt the refresh endpoint exactly once, and on success SHALL retry the original request with the new Access_Token.
10. IF the refresh attempt in the Web_App fails, THEN THE Web_App SHALL clear stored tokens and redirect the user to the login route.
11. THE API SHALL sign Access_Tokens and Refresh_Tokens using distinct secrets configured through the environment.
12. WHEN a request to a role-restricted endpoint is made by a user whose role is not authorized, THE API SHALL reject the request with an HTTP 403 response.
13. WHEN an unauthenticated user navigates to a protected Web_App route, THE Web_App SHALL redirect the user to the login route.

### Requirement 2: Live Data Mode versus Mock Mode

**User Story:** As an operator, I want live mode to use only real backend data, so that production never displays fabricated scores or reports. *(Live mode / mock policy, Audit B8)*

#### Acceptance Criteria

1. WHILE the Web_App is configured with `NEXT_PUBLIC_API_MODE` equal to `live`, THE Web_App SHALL retrieve all scan, dashboard, report, and project data from the real API only.
2. WHILE the Web_App is in Live_Mode, THE Web_App SHALL NOT render mock-generated scores, findings, or reports under any condition, even if mock rendering is somehow triggered.
2a. WHILE `NEXT_PUBLIC_API_MODE` is `live`, THE Web_App SHALL prevent Mock_Mode from activating regardless of other configuration.
3. WHERE the Web_App is configured with `NEXT_PUBLIC_API_MODE` equal to `mock`, THE Web_App SHALL serve locally generated demo data for local demonstration.
4. IF the deployment environment is production AND `NEXT_PUBLIC_API_MODE` is set to `mock`, THEN THE Web_App SHALL refuse to operate in Mock_Mode unless `ALLOW_MOCK_IN_PRODUCTION` is explicitly set.
5. WHERE `ALLOW_MOCK_IN_PRODUCTION` is explicitly set in a production environment, THE Web_App SHALL permit Mock_Mode and SHALL display a visible indicator that mock data is in use.
6. WHEN the Web_App resolves an unmodeled mutation in Mock_Mode, THE Web_App SHALL emit a console warning identifying the unmodeled operation.

### Requirement 3: Frontend-to-API Contract Alignment for Scans

**User Story:** As a developer, I want the scan submission and scan actions in the UI to match the API contract exactly, so that real GitHub scans and rerun actions work end-to-end. *(Audit A1, B7, B8)*

#### Acceptance Criteria

1. WHEN a user submits a repository scan from the Web_App scan-creation surface, THE Web_App SHALL send `sourceType` equal to `repository` in the create-scan request.
2. THE Web_App SHALL reference the `sourceType` value from a shared constant defined in Shared_Schemas rather than a free-typed string literal.
3. WHEN a create-scan request is received at the API, THE API SHALL validate the request body against the shared create-scan Zod schema and SHALL reject a body that does not conform with an HTTP 400 response.
4. WHEN a user activates the rerun action on a completed scan report, THE Web_App SHALL call a real API rerun endpoint.
5. WHEN a rerun request is received for an existing scan, THE API SHALL create a new queued ScanJob that references the same source parameters as the original scan.
6. WHILE any scan-related view is loading, fetching empty results, or has encountered an error, THE Web_App SHALL render a distinct loading state, empty state, or error state respectively.
7. WHEN a scan-related query in the Web_App fails, THE Web_App SHALL render an error state that includes a retry affordance.

### Requirement 4: Real GitHub Repository Intake

**User Story:** As a developer, I want to scan a public GitHub repository by pasting its URL, so that I can audit real code safely. *(Audit A1, B3)*

#### Acceptance Criteria

1. WHEN a Repository_URL is submitted, THE GitHub_Ingestion_Service SHALL accept it only if the scheme is `https` and the host is `github.com`.
2. IF a Repository_URL uses a scheme other than `https` or a host other than `github.com`, THEN THE GitHub_Ingestion_Service SHALL reject the request with an HTTP 400 response.
3. WHERE the request includes an optional branch or ref, THE GitHub_Ingestion_Service SHALL validate that the ref contains only characters permitted in Git reference names before using it.
4. WHERE the request includes a Scan_Mode of `full`, `fast`, `security-only`, `frontend-only`, or `backend-only`, THE API SHALL scope the scan according to the selected Scan_Mode.
5. WHEN fetching a repository, THE GitHub_Ingestion_Service SHALL perform a shallow fetch bounded by a configurable fetch-timeout, a maximum repository size, a maximum file count, and a maximum per-file size.
6. IF a fetched repository exceeds the maximum repository size, the maximum file count, the maximum per-file size, or the fetch-timeout, THEN THE GitHub_Ingestion_Service SHALL abort the fetch, mark the ScanJob status as `failed`, and record a descriptive reason.
7. THE GitHub_Ingestion_Service SHALL exclude binary files and `.git` metadata from the files placed into the Scan_Directory.
8. WHEN writing any repository entry or any uploaded archive entry into the Scan_Directory, THE GitHub_Ingestion_Service SHALL confine the resolved path within the Scan_Directory and SHALL reject any entry whose resolved path escapes the Scan_Directory.
8a. IF any entry's resolved path escapes the Scan_Directory, THEN THE GitHub_Ingestion_Service SHALL fail the entire scan immediately rather than skipping the entry and continuing.
9. THE GitHub_Ingestion_Service SHALL fetch and scan repository contents without executing any code contained in the repository.
10. WHEN a scan completes or fails, THE Scan_Worker SHALL remove the Scan_Directory and its temporary contents.
10a. WHEN a scan ends in any intermediate or non-success terminal state, including timeout or cancellation, THE Scan_Worker SHALL remove the Scan_Directory and its temporary contents.
11. WHEN constructing fetch operations from a Repository_URL or ref, THE GitHub_Ingestion_Service SHALL prevent shell injection and server-side request forgery by validating inputs against the host allowlist and avoiding unsanitized shell interpolation.

### Requirement 5: Scanner Pipeline Robustness

**User Story:** As a reviewer, I want analyzers to run reliably on arbitrary repositories and to report their own status, so that one analyzer failure never crashes a scan and coverage is visible. *(Audit A5)*

#### Acceptance Criteria

1. WHEN the Scanner_Orchestrator runs a scan, THE Scanner_Orchestrator SHALL record an Analyzer_Status of `ran`, `skipped`, or `failed` for each Analyzer.
2. IF a single Analyzer throws or fails during a scan, THEN THE Scanner_Orchestrator SHALL record that Analyzer as `failed` and SHALL continue running the remaining analyzers without aborting the scan.
3. WHEN the ESLint Analyzer runs, THE ESLint Analyzer SHALL use a bundled baseline configuration rather than relying on the scanned repository's ESLint configuration.
4. WHERE the scanned repository contains a `tsconfig.json`, THE TypeScript Analyzer SHALL respect that configuration when compiling the repository.
5. WHERE no repository `tsconfig.json` is present, THE TypeScript Analyzer SHALL fall back to a lenient baseline configuration.
6. WHEN the TypeScript Analyzer reports a diagnostic produced from inferred or fallback configuration, THE TypeScript Analyzer SHALL assign a lower confidence than diagnostics produced from the repository's own configuration.
7. WHERE the Semgrep CLI or its rule registry is unavailable, THE Semgrep Analyzer SHALL record an Analyzer_Status of `skipped` rather than failing the scan.
8. WHEN a scan completes, THE Scan_Worker SHALL persist the per-analyzer Analyzer_Status so that coverage is reported through the API.

### Requirement 6: AI Reviewer and Standards Mapping

**User Story:** As a security engineer, I want AI review to be optional, validated, and resistant to prompt injection, so that untrusted repository code cannot manipulate or leak through the reviewer. *(Audit B6)*

#### Acceptance Criteria

1. WHERE a Gemini API key is configured, THE AI_Reviewer SHALL use the Gemini provider for AI review.
2. WHERE no Gemini API key is configured, THE AI_Reviewer SHALL skip live AI review and fall back gracefully without failing the scan.
3. WHEN AI review output is received, THE AI_Reviewer SHALL validate the output against its Zod schema before any AI-produced Finding or summary is persisted.
4. IF AI review output fails schema validation, THEN THE AI_Reviewer SHALL discard the invalid output and continue the scan without persisting it.
5. WHEN content is prepared for the AI_Reviewer, THE Scan_Worker SHALL redact detected secrets from that content before it is sent to the AI provider.
6. WHEN constructing any AI prompt, including fix-plan and Lark-summary prompts, THE AI_Reviewer SHALL frame repository content as untrusted data and SHALL instruct the model to ignore instructions embedded within that content.
7. WHEN findings are produced, THE Standards_Mapper SHALL assign each applicable Finding one or more Standard_Reference identifiers drawn from OWASP, CWE, NIST SSDF, ISO/IEC 25010, and WCAG 2.2.
8. WHEN a Finding has no specifically matching standard, THE Standards_Mapper SHALL assign a documented fallback Standard_Reference so that every Finding carries at least one reference.

### Requirement 7: Scoring Engine Correctness

**User Story:** As a team lead, I want the score and verdict to follow documented weights and bands and to mean the same thing in the frontend and backend, so that the verdict is trustworthy. *(Audit C1)*

#### Acceptance Criteria

1. WHEN findings for a scan have been persisted, THE Scoring_Service SHALL compute an overall score, per-category scores using the documented category weights, and a Status_Result.
2. THE Scoring_Service SHALL assign the Status_Result from the overall score using the documented bands: 90–100 `passed`, 80–89 `passed-with-warnings`, 70–79 `needs-cleanup`, 60–69 `risky`, and 0–59 `blocked`.
3. IF any persisted Finding matches an Auto_Block_Condition, THEN THE Scoring_Service SHALL set the Status_Result to `blocked` regardless of the overall score and SHALL record the blocking reasons.
3a. WHEN an Auto_Block_Condition is matched, THE Scoring_Service SHALL bypass band-based Status_Result assignment entirely and SHALL NOT assign a Status_Result from the score bands.
4. THE Scoring_Service SHALL produce a score object whose shape conforms to the shared score schema in Shared_Schemas.
5. THE Shared_Schemas SHALL define the meaning of each per-category score so that the Web_App labels and the API columns agree on category semantics.
6. WHEN scoring completes, THE Scan_Worker SHALL persist the overall score, per-category scores, and Status_Result onto the ScanJob row.

### Requirement 8: Reports and Dashboard Real Data

**User Story:** As a user, I want reports and dashboard metrics to reflect real scan data with consistent shapes, so that KPIs and findings are accurate. *(Audit A2, B7, B8)*

#### Acceptance Criteria

1. THE Shared_Schemas SHALL define a single set of types for the dashboard summary, dashboard trend points, top issues, and standard violations.
2. WHEN the dashboard data endpoints respond, THE API SHALL return data conforming to the shared dashboard types defined in Shared_Schemas.
3. WHEN the Web_App renders dashboard KPI cards, the verdict distribution, the trend line, top-issue bars, and standards bars, THE Web_App SHALL read values from the shared dashboard types returned by the API.
4. WHEN a user opens a scan report, THE Web_App SHALL render the report using the persisted scan score, Status_Result, and findings for that scan.
5. WHEN a user filters or sorts findings on the report surface, THE Web_App SHALL apply the filter or sort to the real findings of that scan.
6. WHEN a user opens a finding detail, THE Web_App SHALL display the Finding fields including severity, category, recommendation, and mapped Standard_Reference values.
7. WHEN a user views scan history or a scan timeline, THE Web_App SHALL display real ScanJob records and their stage transitions.
8. WHEN a new scan completes, THE Web_App SHALL invalidate the cached dashboard and scan-list data so that subsequent views reflect the new scan.
9. WHILE a scan is processing, THE API SHALL emit Socket.IO progress events for each stage transition, and THE Web_App SHALL subscribe on mount and unsubscribe on unmount.

### Requirement 9: Lark/Feishu Integration Truthfulness

**User Story:** As an operator, I want Lark notifications to carry real data and record delivery status truthfully, so that the notification audit trail can be trusted. *(Audit B1, B2)*

#### Acceptance Criteria

1. WHERE the Lark webhook is configured, THE Lark_Service SHALL build the notification card from real scan data including the scan author derived from the scan's initiating user and a report URL derived from the public web URL configuration.
2. WHERE the Lark webhook is not configured, THE Lark_Service SHALL skip delivery and record the event as `skipped`.
3. WHEN a Lark delivery is initiated, THE Lark_Service SHALL record the LarkEvent as `pending` before sending the webhook request.
4. WHEN the Lark webhook request returns a success response, THE Lark_Service SHALL update the LarkEvent status to `success`.
4a. THE Lark_Service SHALL update the LarkEvent status to `success` only when the webhook response indicates success, and SHALL NOT record `success` when the webhook response indicates failure.
5. IF the Lark webhook request returns a non-success response or throws, THEN THE Lark_Service SHALL update the LarkEvent status to `failed`.
6. WHEN Lark delivery fails or is skipped, THE Scan_Worker SHALL complete the scan normally and SHALL NOT block scan completion on Lark delivery.
7. THE Lark_Service SHALL NOT include hardcoded placeholder author values or `localhost` report URLs in delivered cards.

### Requirement 10: Security Hardening

**User Story:** As a platform operator, I want request validation, rate limiting, security headers, CORS control, and audit logging, so that the service resists abuse and security actions are traceable. *(Audit B4, B5)*

#### Acceptance Criteria

1. WHEN any request reaches an API endpoint, THE API SHALL validate the request payload against the endpoint's schema and SHALL reject a non-conforming payload with an HTTP 400 response.
2. WHEN the number of login requests from a client exceeds the configured authentication rate limit within the configured window, THE API SHALL reject further login requests with an HTTP 429 response.
3. WHEN the number of scan-creation requests from a client exceeds the configured scan rate limit within the configured window, THE API SHALL reject further scan-creation requests with an HTTP 429 response.
4. THE API SHALL apply security response headers via Helmet to all responses.
5. WHEN a cross-origin request is received, THE API SHALL allow the request only if its origin matches the configured CORS allowlist.
6. WHEN a security-relevant action occurs, including login, scan creation, report view, Lark send, false-positive marking, and admin role changes, THE API SHALL write an Audit_Log entry capturing actor, action, target, IP address, and timestamp.
7. THE API SHALL redact detected secrets from log output and from API responses.
8. IF an unexpected error occurs while handling a request, THEN THE API SHALL return a safe error response that does not include stack traces or internal implementation details.
9. THE API SHALL emit structured logs for requests and security-relevant actions.

### Requirement 11: Environment Validation and Readiness

**User Story:** As an operator, I want hard-required environment variables enforced and optional integrations reported, so that I can tell what is actually configured without the service hard-failing on optional keys. *(Audit A4, C4)*

#### Acceptance Criteria

1. WHEN the API starts in a production environment, THE API SHALL verify that `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, and `CORS_ORIGIN` are present.
2. IF any hard-required environment variable is missing at startup in a production environment, THEN THE API SHALL fail startup and record which variable is missing.
3. WHEN the API starts in a production environment, THE API SHALL verify that the Refresh_Token secret is present and is distinct from `JWT_SECRET`, and SHALL NOT fall back to an insecure literal default in production.
4. WHEN the API starts, THE API SHALL succeed in starting even when the optional Gemini, GitHub token, and Lark environment variables are absent.
5. WHEN the API starts, THE API SHALL emit a one-time startup log summarizing the status of each Integration as `configured`, `skipped`, or `error`.
6. WHEN the Readiness_Endpoint is requested, THE API SHALL report the status of each Integration as `configured`, `skipped`, or `error` without hard-failing.
7. WHERE an optional Integration is not configured, THE Readiness_Endpoint SHALL report that Integration as `skipped`.

### Requirement 12: Testing and Deployment Readiness

**User Story:** As a maintainer, I want regression tests for fixed bugs and accurate operational documentation, so that the system stays correct and can be deployed and recovered confidently. *(Testing & deployment readiness)*

#### Acceptance Criteria

1. THE test suite SHALL include unit, integration, and end-to-end tests covering each defect fixed under Requirements 1 through 11.
2. WHEN the continuous-integration test command runs, THE Web_App tests SHALL execute in a non-watch single-run mode.
3. WHEN the health endpoint is requested, THE API SHALL return an HTTP 200 response indicating service health.
3a. IF the underlying service is unhealthy when the health endpoint is requested, THEN THE API SHALL return an error status code rather than HTTP 200.
4. WHEN the Readiness_Endpoint is requested, THE API SHALL return the per-Integration readiness status as defined in Requirement 11.
5. THE deployment documentation SHALL accurately describe the required environment variables, the deployment steps, a runbook, rollback notes, and known limitations.
6. WHEN a regression test for a previously fixed defect runs, THE test SHALL fail if that defect is reintroduced.

## Out of Scope

The following are intentionally excluded from this spec and are tracked as future work:

1. Scanning repositories on hosts other than `github.com` (for example GitLab, Bitbucket, or self-hosted Git).
2. GitHub App installation, pull-request status checks, and webhook-triggered scans.
3. Paid always-on background workers or autoscaling worker infrastructure beyond the current deployment model.
4. Private repository scanning beyond what an optionally configured GitHub token already enables.
5. SSO, SAML, or third-party identity-provider authentication beyond the existing email/password flow.
6. New analyzer engines beyond the existing FileClassifier, SecretAnalyzer, TypeScript, ESLint, and Semgrep analyzers.
7. Multi-tenant organization management and billing.
