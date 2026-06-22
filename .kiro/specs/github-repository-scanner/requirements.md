# Requirements Document

## Introduction

This feature adds a new scan source type to SlopShield AI that lets a user submit a **public GitHub repository URL** (with an optional branch or ref) and have that repository scanned end-to-end through the **existing scan pipeline**. The feature reuses the current NestJS scan orchestration (`ScanService.createScan`), BullMQ `scan-pipeline` queue, `ScanProcessor` stages (fetching → classifying → scanning → ai-reviewing → scoring → reporting → notifying → completed), the `ScannerOrchestrator` analyzers, the `ScoringService`, the `StandardsMapper`, and the shared Zod schemas in `packages/shared`.

The `repository` value already exists in `SourceTypeEnum` (`packages/shared/src/schemas/scan.schema.ts`) but is **not yet handled** in `ScanService.createScan`, which today only supports `paste`, `upload`, and `demo-sample`. This feature implements GitHub ingestion: it validates the supplied URL, safely fetches the repository into the per-scan temporary directory, enforces safety limits against untrusted external repositories, and then hands off to the unchanged classify → scan → score flow. Findings produced by the scan are mapped to the real engineering standards already modeled in the codebase (OWASP Top 10, OWASP API Security Top 10, OWASP ASVS, CWE Top 25, NIST SSDF, ISO/IEC 25010, WCAG 2.2), and the scoring/auto-block verdict aligns with the README's documented score interpretation bands and auto-block conditions.

The goal is to make a GitHub scan produce **real, standards-grounded results** that surface through the existing REST endpoints (`/scans`, `/scans/:id`, `/scans/:id/findings`) and Socket.IO progress events that the frontend hooks already consume.

### In Scope

- A new GitHub repository ingestion path inside the existing `createScan` flow keyed on `sourceType: "repository"`.
- GitHub URL validation and host allowlisting.
- Safe repository fetch (shallow clone or tarball download) into the per-scan temp directory.
- Safety limits: maximum repository size, maximum file count, fetch timeout, and exclusion of `node_modules`, `.git`, build artifacts, and binary files.
- Unchanged handoff to the existing classify → scan → AI review → score → report → notify pipeline.
- Standards mapping of findings via the existing `StandardsMapper` and shared `STANDARDS_REFERENCES`.
- Scoring and auto-block verdict alignment with the README and shared constants.
- Error handling for invalid URL, repository not found, repository too large, fetch timeout, and empty repository.
- Surfacing of real GitHub scan results through the existing REST + Socket.IO surface.

### Out of Scope

- Private repository scanning (public repositories only for v1, unless an optional token is configured — see Requirement 9).
- GitHub App installation, pull-request status checks, and webhook-triggered scans.
- Hosting the backend or flipping the deployed Vercel frontend to "live mode" (tracked as separate follow-on milestones; noted here only as a dependency/assumption).
- Changes to the analyzer logic inside `packages/scanner-plugins` (the analyzers run unchanged on the fetched files).

### Dependencies and Assumptions

- The existing pipeline (`ScanProcessor`, `ScannerOrchestrator`, `ScoringService`, `StandardsMapper`, `LarkService`, `NotificationService`) is operational and consumes a populated per-scan directory.
- The frontend dashboard already calls `/scans`, `/scans/:id`, and `/scans/:id/findings` and subscribes to Socket.IO progress events; flipping the deployed frontend to consume live backend data is a separate milestone and is assumed, not implemented here.
- A fetch mechanism (git CLI, `simple-git`, or GitHub tarball via the REST API) is available in the API runtime environment; the specific mechanism is a design decision (see Requirement 4).
- Network egress from the API to `github.com` and (optionally) `codeload.github.com` / `api.github.com` is permitted.

## Glossary

- **GitHub_Ingestion_Service**: The backend component (new, or an extension of `ScanService`) responsible for validating a GitHub URL and fetching the repository into the per-scan temporary directory.
- **Repository_URL**: The HTTPS URL identifying a public GitHub repository, optionally accompanied by a branch or ref.
- **Repository_Ref**: An optional branch name, tag, or commit reference indicating which revision of the repository to fetch.
- **Scan_Directory**: The per-scan temporary directory (`temp-scans/{scanId}`) into which source files are placed before the pipeline runs; consumed by `ScanProcessor`.
- **Scan_Pipeline**: The existing BullMQ `scan-pipeline` worker (`ScanProcessor`) that runs fetching, classifying, scanning, ai-reviewing, scoring, reporting, and notifying stages.
- **Scanner_Orchestrator**: The existing `ScannerOrchestrator` that runs the static analyzers (`SecretAnalyzer`, `ESLintAnalyzer`, `TypeScriptAnalyzer`, `SemgrepAnalyzer`, `SlopAnalyzer`) in parallel.
- **Standards_Mapper**: The existing `StandardsMapper` (`apps/api/src/rules/standards-mapper.ts`) that maps a finding to one or more standard reference IDs.
- **Standard_Reference**: A concrete external engineering standard reference (for example "OWASP A01:2021", "CWE-798", "WCAG 2.2 SC 1.1.1", "NIST SSDF", "ISO/IEC 25010") drawn from the shared `STANDARDS_REFERENCES` constant.
- **Scoring_Service**: The existing `ScoringService` that computes the overall score, per-category scores, and the `statusResult` verdict.
- **Auto_Block_Condition**: A condition from the shared `AUTO_BLOCK_CONDITIONS` constant that forces a `blocked` verdict regardless of overall score.
- **Status_Result**: The scan verdict value (`passed`, `passed-with-warnings`, `needs-cleanup`, `risky`, `blocked`) derived from the score thresholds and auto-block conditions.
- **Safety_Limit**: A configured bound (maximum repository size, maximum file count, or fetch timeout) that protects the API from oversized or hostile repositories.
- **Excluded_Path**: A file or directory that the GitHub_Ingestion_Service removes or skips before scanning (for example `node_modules`, `.git`, build output directories, and binary files).
- **ScanJob**: The Prisma `ScanJob` row that records `sourceType`, `sourceRef`, `status`, `statusResult`, scores, and timestamps.
- **Finding**: A normalized issue produced by the analyzers or AI reviewer, carrying `severity`, `category`, `title`, `whyItMatters`, `recommendation`, `standardReferences`, `blocking`, `confidence`, `source`, `codeSnippet`, and `suggestedTests`.

## Requirements

### Requirement 1: Submit a GitHub Repository for Scanning

**User Story:** As a developer, I want to submit a public GitHub repository URL with an optional branch, so that the repository is scanned end-to-end through the existing SlopShield pipeline and produces real results.

#### Acceptance Criteria

1. WHEN a scan creation request is received with `sourceType` equal to `repository` and a non-empty `sourceRef`, THE GitHub_Ingestion_Service SHALL accept the request and treat `sourceRef` as the Repository_URL.
2. IF a scan creation request has `sourceType` equal to `repository` AND `sourceRef` is empty or missing, THEN THE GitHub_Ingestion_Service SHALL reject the request with an HTTP 400 response and a message stating that a repository URL is required.
3. WHERE the request includes a Repository_Ref (branch, tag, or commit), THE GitHub_Ingestion_Service SHALL fetch the specified ref instead of the repository default branch.
4. WHEN a `repository` scan request is accepted, THE GitHub_Ingestion_Service SHALL create a ScanJob row with `sourceType` equal to `repository`, `status` equal to `queued`, and `sourceRef` set to the submitted Repository_URL.
5. WHEN the ScanJob row has been created and the repository fetch has been initiated, THE GitHub_Ingestion_Service SHALL enqueue a job on the `scan-pipeline` queue carrying the `scanId` and the Scan_Directory path.
6. THE GitHub_Ingestion_Service SHALL preserve the existing behavior of the `paste`, `upload`, and `demo-sample` source types without modification to their ingestion logic.

### Requirement 2: Validate and Allowlist the Repository URL

**User Story:** As a platform operator, I want submitted repository URLs to be strictly validated, so that the system only fetches from trusted GitHub hosts and rejects unsafe inputs.

#### Acceptance Criteria

1. WHEN a Repository_URL is submitted, THE GitHub_Ingestion_Service SHALL accept the URL only if the scheme is `https` and the host is `github.com`.
2. IF a Repository_URL uses any scheme other than `https`, THEN THE GitHub_Ingestion_Service SHALL reject the request with an HTTP 400 response and a message identifying the disallowed scheme.
3. IF a Repository_URL references a host other than `github.com`, THEN THE GitHub_Ingestion_Service SHALL reject the request with an HTTP 400 response and a message stating that only github.com repositories are supported.
4. IF a Repository_URL uses an SSH form (for example `git@github.com:owner/repo.git`) or a local or file path, THEN THE GitHub_Ingestion_Service SHALL reject the request with an HTTP 400 response.
5. WHEN a Repository_URL passes host and scheme validation, THE GitHub_Ingestion_Service SHALL extract the repository owner and name and confirm that both are present before fetching.
6. IF the owner or repository name cannot be extracted from a Repository_URL, THEN THE GitHub_Ingestion_Service SHALL reject the request with an HTTP 400 response and a message stating that the URL is not a valid GitHub repository URL.
7. WHEN a Repository_Ref is supplied, THE GitHub_Ingestion_Service SHALL validate that the ref contains only characters permitted in Git reference names before using the ref in any fetch operation.

### Requirement 3: Enforce Safety Limits on Untrusted Repositories

**User Story:** As a platform operator, I want repository fetches to be bounded by size, file count, and time limits, so that a hostile or oversized repository cannot exhaust system resources.

#### Acceptance Criteria

1. THE GitHub_Ingestion_Service SHALL enforce a configurable maximum repository size Safety_Limit when fetching a repository.
2. IF the fetched repository exceeds the maximum repository size Safety_Limit, THEN THE GitHub_Ingestion_Service SHALL abort the fetch, mark the ScanJob `status` as `failed`, and record a descriptive reason indicating the size limit was exceeded.
3. THE GitHub_Ingestion_Service SHALL enforce a configurable maximum file count Safety_Limit on the files placed into the Scan_Directory.
4. IF the repository file count after exclusions exceeds the maximum file count Safety_Limit, THEN THE GitHub_Ingestion_Service SHALL abort the scan, mark the ScanJob `status` as `failed`, and record a descriptive reason indicating the file-count limit was exceeded.
5. THE GitHub_Ingestion_Service SHALL enforce a configurable fetch-timeout Safety_Limit on the repository fetch operation.
6. IF the repository fetch does not complete within the fetch-timeout Safety_Limit, THEN THE GitHub_Ingestion_Service SHALL terminate the fetch operation, mark the ScanJob `status` as `failed`, and record a descriptive reason indicating the fetch timed out.
7. THE GitHub_Ingestion_Service SHALL exclude `node_modules`, `.git`, and common build-output directories from the files placed into the Scan_Directory.
8. THE GitHub_Ingestion_Service SHALL exclude binary files from the files placed into the Scan_Directory so that only text source files are scanned.
9. WHEN repository files are written into the Scan_Directory, THE GitHub_Ingestion_Service SHALL confine all written paths to within the Scan_Directory and reject any entry whose resolved path escapes the Scan_Directory.
10. THE GitHub_Ingestion_Service SHALL fetch repository contents without executing any code contained in the repository.

### Requirement 4: Repository Fetch Mechanism

**User Story:** As a maintainer, I want the repository fetch to use a well-maintained, shallow approach, so that fetches are fast, predictable, and reuse existing tooling conventions.

#### Acceptance Criteria

1. THE GitHub_Ingestion_Service SHALL fetch the repository contents into the Scan_Directory using one of the following mechanisms selected during design: a shallow Git clone via the git CLI, a shallow clone via a maintained Git library such as simple-git, or a repository tarball download via the GitHub REST API.
2. WHERE a Git clone mechanism is selected, THE GitHub_Ingestion_Service SHALL perform a shallow clone with a depth of 1 against the resolved Repository_Ref or default branch.
3. WHEN the repository contents have been fetched into the Scan_Directory, THE GitHub_Ingestion_Service SHALL remove version-control metadata so that `.git` contents are not scanned.
4. THE GitHub_Ingestion_Service SHALL produce a Scan_Directory whose layout matches what `ScanProcessor` already expects, so that the classifying and scanning stages run without modification.
5. WHEN a configuration value selects the fetch mechanism, THE GitHub_Ingestion_Service SHALL use the configured mechanism for all `repository` scans.

### Requirement 5: Hand Off to the Existing Scan Pipeline Unchanged

**User Story:** As a developer, I want a GitHub scan to run through the same classify, scan, AI review, and score stages as other source types, so that results are consistent regardless of how the code was submitted.

#### Acceptance Criteria

1. WHEN repository fetch and safety enforcement complete successfully, THE GitHub_Ingestion_Service SHALL enqueue the scan on the existing `scan-pipeline` queue with the `scanId` and Scan_Directory path.
2. WHEN the Scan_Pipeline processes a `repository` scan, THE Scan_Pipeline SHALL run the existing fetching, classifying, scanning, ai-reviewing, scoring, reporting, and notifying stages without source-type-specific branching in the analyzers.
3. WHEN the Scan_Pipeline runs the scanning stage for a `repository` scan, THE Scanner_Orchestrator SHALL run the existing analyzers against the fetched files using the existing `AnalysisContext` shape (`scanDir`, `files`, `scanId`).
4. WHEN the Scan_Pipeline completes processing a `repository` scan, THE Scan_Pipeline SHALL remove the Scan_Directory as it does for other source types.
5. WHILE a `repository` scan is processing, THE Scan_Pipeline SHALL broadcast progress events over the existing Socket.IO gateway for each stage transition.

### Requirement 6: Map Findings to Real Engineering Standards

**User Story:** As a reviewer, I want each applicable finding from a GitHub scan to cite a concrete engineering standard, so that I can justify and prioritize remediation against recognized standards.

#### Acceptance Criteria

1. WHEN findings are produced for a `repository` scan, THE Standards_Mapper SHALL evaluate each finding and assign one or more Standard_Reference identifiers drawn from the shared `STANDARDS_REFERENCES` constant where an applicable standard exists.
2. WHERE a finding relates to access control or authorization, THE Standards_Mapper SHALL include an OWASP Top 10 reference (for example A01:2021 Broken Access Control) and the OWASP API Security Top 10 reference.
3. WHERE a finding relates to injection (SQL, command, or HTML/XSS), THE Standards_Mapper SHALL include an OWASP Top 10 injection reference (for example A03:2021) and a CWE Top 25 reference.
4. WHERE a finding relates to hardcoded secrets or credentials, THE Standards_Mapper SHALL include a CWE Top 25 reference and a NIST SSDF reference.
5. WHERE a finding relates to accessibility, THE Standards_Mapper SHALL include a WCAG 2.2 reference and an ISO/IEC 25010 reference.
6. WHERE a finding relates to maintainability, architecture, testability, or reliability, THE Standards_Mapper SHALL include an ISO/IEC 25010 reference and the relevant craftsmanship reference defined in `STANDARDS_REFERENCES`.
7. WHEN a finding has no specifically matching standard, THE Standards_Mapper SHALL assign a documented fallback Standard_Reference so that every finding carries at least one reference.
8. WHEN findings are persisted for a `repository` scan, THE Scan_Pipeline SHALL store the mapped Standard_Reference values on each Finding record.

### Requirement 7: Align Scoring and Auto-Block Verdict with Documented Bands

**User Story:** As a team lead, I want the GitHub scan score and verdict to follow the documented interpretation bands and auto-block conditions, so that the verdict is trustworthy and consistent with the published standards model.

#### Acceptance Criteria

1. WHEN findings for a `repository` scan have been persisted, THE Scoring_Service SHALL compute an overall score, per-category scores, and a Status_Result.
2. THE Scoring_Service SHALL assign the Status_Result from the overall score using the documented bands: 90–100 passed, 80–89 passed-with-warnings, 70–79 needs-cleanup, 60–69 risky, and 0–59 blocked.
3. IF any persisted finding matches an Auto_Block_Condition from the shared `AUTO_BLOCK_CONDITIONS` constant, THEN THE Scoring_Service SHALL set the Status_Result to `blocked` regardless of the overall score.
4. IF a `repository` scan contains a hardcoded secret, a missing authorization control, an unsafe dynamic execution pattern, a dangerous HTML rendering pattern, an unsafe file upload pattern, a SQL injection risk, or broken TypeScript compilation in a critical module, THEN THE Scoring_Service SHALL set the Status_Result to `blocked` and record the corresponding blocking reason.
5. WHEN the Scoring_Service computes a Status_Result of `blocked` due to an Auto_Block_Condition, THE Scan_Pipeline SHALL record the blocking reasons on the scan so they are available through the API.
6. WHEN scoring completes for a `repository` scan, THE Scan_Pipeline SHALL persist the overall score, per-category scores, and Status_Result onto the ScanJob row.

### Requirement 8: Surface Real Results Through the Existing API

**User Story:** As a frontend consumer, I want GitHub scan results to be available through the existing scan endpoints and progress events, so that the dashboard displays real scan data without new integration work.

#### Acceptance Criteria

1. WHEN a `repository` scan has been created, THE backend SHALL include it in the `GET /scans` listing with its `sourceType` equal to `repository` and its `sourceRef` set to the Repository_URL.
2. WHEN a client requests `GET /scans/:id` for a completed `repository` scan, THE backend SHALL return the ScanJob with its overall score, per-category scores, Status_Result, and associated findings.
3. WHEN a client requests `GET /scans/:id/findings` for a `repository` scan, THE backend SHALL return the persisted findings including their `severity`, `category`, `title`, `recommendation`, and mapped Standard_Reference values.
4. WHILE a `repository` scan is processing, THE backend SHALL emit Socket.IO progress events identifying the current stage and percentage for the scan.
5. THE backend SHALL represent `repository` scan results using the same shared response schemas used for other source types so that the frontend hooks consume them without schema changes.

### Requirement 9: Optional Authentication Token for Higher Rate Limits and Private Repositories

**User Story:** As a platform operator, I want to optionally configure a GitHub token, so that the system can avoid anonymous rate limits and, where explicitly enabled, access private repositories.

#### Acceptance Criteria

1. WHERE a GitHub access token is configured in the API environment, THE GitHub_Ingestion_Service SHALL include the token as authentication when fetching repository contents.
2. WHERE no GitHub access token is configured, THE GitHub_Ingestion_Service SHALL fetch public repositories using anonymous access.
3. IF a private repository is requested AND no GitHub access token is configured, THEN THE GitHub_Ingestion_Service SHALL reject the request with an error indicating that private repositories require a configured token.
4. WHEN a GitHub access token is used, THE GitHub_Ingestion_Service SHALL keep the token value out of stored ScanJob records, findings, logs, and API responses.

### Requirement 10: Redact Secrets Before AI Review

**User Story:** As a security engineer, I want secrets detected in a fetched repository to be redacted before AI review, so that untrusted external code does not leak credentials to the AI provider.

#### Acceptance Criteria

1. WHEN the Scan_Pipeline prepares file contents for the ai-reviewing stage of a `repository` scan, THE Scan_Pipeline SHALL redact detected secrets from the content sent to the AI reviewer.
2. THE Scan_Pipeline SHALL treat repository source content as untrusted data and SHALL NOT allow comments or text within the repository to override reviewer or system instructions during AI review.
3. WHEN AI review output is received for a `repository` scan, THE Scan_Pipeline SHALL validate the output against the expected schema before persisting any AI-produced finding.

### Requirement 11: Error Handling for Repository Ingestion Failures

**User Story:** As a developer, I want clear and specific errors when a repository cannot be scanned, so that I can correct the input or understand why the scan failed.

#### Acceptance Criteria

1. IF the Repository_URL is syntactically invalid, THEN THE GitHub_Ingestion_Service SHALL reject the request with an HTTP 400 response and a message stating that the URL is invalid.
2. IF the repository or the requested Repository_Ref does not exist or is not accessible, THEN THE GitHub_Ingestion_Service SHALL fail the scan with a descriptive reason indicating the repository or ref was not found.
3. IF the repository fetch fails due to a network or transport error, THEN THE GitHub_Ingestion_Service SHALL mark the ScanJob `status` as `failed` and record a descriptive network-error reason.
4. IF the fetched repository contains no scannable source files after exclusions, THEN THE Scan_Pipeline SHALL complete the scan with a result indicating that the repository was empty and SHALL produce a score of 0 findings rather than crashing.
5. WHEN any repository ingestion failure occurs, THE GitHub_Ingestion_Service SHALL remove the partially populated Scan_Directory to avoid leaving temporary files behind.
6. WHEN a `repository` scan fails during ingestion, THE backend SHALL expose the failure status and reason through the existing scan endpoints so the frontend can display it.
7. IF a transient fetch failure occurs, THEN THE GitHub_Ingestion_Service SHALL surface the failure with a reason that distinguishes a transient transport error from an invalid-input error.
