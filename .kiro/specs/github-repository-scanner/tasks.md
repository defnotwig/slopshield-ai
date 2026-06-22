# Implementation Plan: GitHub Repository Scanner

## Overview

This plan implements the `repository` source type for SlopShield AI by adding a new `GitHubIngestionService` that validates a GitHub URL, streams the repository tarball with size/time/file-count caps, safely extracts it (path-traversal guard, top-folder strip, exclusions) into the per-scan directory, and hands off to the existing unchanged BullMQ pipeline. It also adds secret redaction before AI review, a `failureReason` column for surfacing ingestion failures, and a standards-mapping fallback so every finding carries at least one reference.

All code is TypeScript. Work reuses existing modules (`ScanService`, `ScanProcessor`, `ScannerOrchestrator`, `ScoringService`, `StandardsMapper`, `SecretAnalyzer`) and extends rather than rewrites them. Tests use Jest + fast-check (≥100 iterations per property), with `fetch` mocked (no real network) and each property test tagged `// Feature: github-repository-scanner, Property N`.

## Tasks

- [x] 1. Add dependencies and ingestion config
  - [x] 1.1 Add `node-tar` (and `@types/tar` if not bundled) to `apps/api`
    - Add `tar` to `dependencies` and `@types/tar` to `devDependencies` in `apps/api/package.json`
    - Add `fast-check` to `apps/api` `devDependencies` for property-based tests
    - Update the pnpm lockfile (`pnpm install`) so the workspace resolves the new packages
    - _Requirements: 4.1, 4.5_

  - [x] 1.2 Create the ingestion config module `apps/api/src/scan/github-ingestion.config.ts`
    - Define `GitHubIngestionConfig` interface (`maxRepoBytes`, `maxFileCount`, `fetchTimeoutMs`, `githubToken?`, `fetchMechanism: "tarball"`)
    - Implement `loadGitHubIngestionConfig(env = process.env)` with defaults: `MAX_REPO_BYTES=100MB`, `MAX_FILE_COUNT=5000`, `FETCH_TIMEOUT_MS=60000`, optional `GITHUB_TOKEN`, `fetchMechanism="tarball"`
    - Document the new env vars in `apps/api/.env`/`.env.example`
    - _Requirements: 3.1, 3.3, 3.5, 4.5, 9.1, 9.2_

  - [ ]\* 1.3 Write unit tests for config loading
    - Assert defaults apply when env vars are absent and overrides apply when present
    - Assert `githubToken` is `undefined` when env value is empty
    - _Requirements: 3.1, 3.3, 3.5, 9.2_

- [x] 2. Implement URL/ref validation in `GitHubIngestionService`
  - [x] 2.1 Create `apps/api/src/scan/github-ingestion.service.ts` skeleton with error type and validation
    - Define `ParsedRepo`, `IngestionResult`, `IngestionErrorKind` (discriminated union), and `GitHubIngestionError extends Error` (with `kind` and `transient` flag)
    - Implement `validateUrl(rawUrl)`: enforce `https` scheme + exact `github.com` host allowlist; throw `GitHubIngestionError("invalid-url" | "not-a-repo-url")`; reject SSH/`file://`/userinfo tricks
    - Implement `parseRepo(url)`: extract `owner`/`repo` (strip `.git`), validate against `^[A-Za-z0-9._-]+$`, and capture optional ref from `/tree/<ref>` or `/commit/<sha>`
    - Implement `validateRef(ref)`: enforce git ref-name allowlist (reject whitespace, `~ ^ : ? * [ \`, `..`, `@{`, leading `-`/`/`, trailing `/` or `.lock`); throw `GitHubIngestionError("invalid-ref")`
    - Inject the config from task 1.2 via the constructor
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 11.1_

  - [x]\* 2.2 Write property test for URL allowlist
    - **Property 1: URL allowlist safety**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6**
    - Generate arbitrary scheme/host/path combos plus adversarial hosts (`github.com@evil.com`, `raw.githubusercontent.com`, `github.com.attacker.com`); assert accept ⇔ https + github.com + valid owner/repo; ≥100 runs

  - [x]\* 2.3 Write property test for ref validation
    - **Property 2: Ref validation safety**
    - **Validates: Requirements 2.7**
    - Generate arbitrary strings incl. illegal-char alphabets, `..`, `@{`, leading `-`; assert accept ⇔ ref rules; ≥100 runs

  - [x]\* 2.4 Write unit tables for URL and ref validation
    - URL rows: valid HTTPS, `.git` suffix, `/tree/<branch>`, `/commit/<sha>`, SSH form, `file://`, `ftp://`, other hosts, userinfo trick, missing repo — assert accept/reject + message
    - Ref rows: valid (`main`, `feature/x`, `v1.2.3`) and invalid (`..`, `a b`, `-x`, `x.lock`, `re~f`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 11.1_

- [x] 3. Implement tarball fetch with streaming size cap and timeout
  - [x] 3.1 Implement `fetchTarball(parsed, scanId)` in `github-ingestion.service.ts`
    - Build the `api.github.com/repos/{owner}/{repo}/tarball/{ref}` URL (encode ref); set `User-Agent`/`Accept` headers; add `Authorization: Bearer <token>` only when configured (Req 9.1) and never log it (Req 9.4)
    - Use `AbortController` + `setTimeout(fetchTimeoutMs)` to enforce the fetch timeout; map `AbortError` → `timeout`
    - Map response status: 404 → `not-found`; 401/403 → `private-no-token` (no token) or `network-error` (token present); other non-ok → `network-error` (transient); fetch throw → `network-error` (transient)
    - Wrap the web body in a `Transform` that accumulates bytes and aborts with `too-large` once `maxRepoBytes` is exceeded; clear the timeout on stream close
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 9.1, 9.3, 9.4, 11.2, 11.3, 11.7_

  - [x]\* 3.2 Write property test for size cap
    - **Property 3: Size-cap safety**
    - **Validates: Requirements 3.1, 3.2**
    - Feed mocked streams of random total size around `MAX_REPO_BYTES`; assert abort iff over cap and forwarded bytes ≤ cap; ≥100 runs

  - [x]\* 3.3 Write unit tests for fetch error mapping, token header, and timeout
    - Error mapping: 404 → `not-found`; 403 no token → `private-no-token`; fetch throw → `network-error` (`transient=true`); abort → `timeout`
    - Token header: assert `Authorization` present/absent based on `GITHUB_TOKEN`; assert token absent from any logged output (Req 9.4)
    - Timeout: Jest fake timers + never-resolving mocked fetch; assert timeout fires at `FETCH_TIMEOUT_MS`
    - _Requirements: 3.5, 3.6, 9.1, 9.2, 9.3, 9.4, 11.2, 11.3, 11.7_

- [x] 4. Implement safe tar extraction
  - [x] 4.1 Implement `safeExtract(tarStream, scanDir)` in `github-ingestion.service.ts`
    - Pipe `tarStream` → `createGunzip()` → `tar.extract({ cwd: scanDir, strip: 1, filter })`
    - Define `EXCLUDED_DIRS` (`node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `.turbo`, `coverage`, `.cache`, `vendor`, `__pycache__`, `.venv`) and `BINARY_EXT` sets
    - Filter: reject excluded dirs, binary extensions, symlinks and hard links; path-traversal guard via `path.resolve` containment check inside `scanDir`; count `File` entries and abort with `too-many-files` once `maxFileCount` is exceeded; accumulate `totalBytes`
    - Return `{ fileCount, totalBytes }`
    - _Requirements: 3.3, 3.4, 3.7, 3.8, 3.9, 3.10, 4.2, 4.3, 4.4_

  - [x]\* 4.2 Write property test for file-count cap
    - **Property 4: File-count-cap safety**
    - **Validates: Requirements 3.3, 3.4**
    - Generate entry lists of random length around `MAX_FILE_COUNT`; assert abort iff over cap; ≥100 runs

  - [x]\* 4.3 Write property test for exclusion filter
    - **Property 5: Exclusion-filter correctness**
    - **Validates: Requirements 3.7, 3.8, 4.3**
    - Generate random relative paths, some under excluded dirs / with binary extensions; assert excluded entries never retained, text entries retained; ≥100 runs

  - [x]\* 4.4 Write property test for path traversal
    - **Property 6: Path-traversal safety**
    - **Validates: Requirements 3.9, 3.10**
    - Generate adversarial entry names (`../`, absolute, mixed separators, symlinks, hard links); assert no accepted destination escapes `scanDir`; ≥100 runs

  - [x]\* 4.5 Write property test for pipeline-shape compatibility
    - **Property 7: Pipeline-shape compatibility**
    - **Validates: Requirements 4.4, 5.3**
    - Generate archives with a top folder + nested files; assert all outputs relative, top folder stripped, and consumable by `FileClassifier`; ≥100 runs

  - [x]\* 4.6 Write unit tests for exclusion filter and no-execution sentinel
    - Spot-check `node_modules/...`, `.git/...`, `dist/...`, `logo.png`, `app.ts`
    - No-execution: fixture archive with a hostile `postinstall`/hook script that would write a sentinel file; assert sentinel never created after ingestion
    - _Requirements: 3.7, 3.8, 3.10, 4.3_

- [x] 5. Implement the `ingest` orchestrator with cleanup
  - [x] 5.1 Implement `ingest(rawUrl, ref, scanId, scanDir)` in `github-ingestion.service.ts`
    - Orchestrate `validateUrl` → `validateRef` → `fetchTarball` → `safeExtract`; return `IngestionResult`
    - On any failure, remove the partially populated `scanDir` and rethrow the `GitHubIngestionError`
    - _Requirements: 1.3, 11.5_

  - [x]\* 5.2 Write property test for cleanup-on-failure
    - **Property 13: Cleanup-on-failure safety**
    - **Validates: Requirements 11.5**
    - Inject each `IngestionErrorKind` and assert `scanDir` does not exist after the failure is handled; ≥100 runs

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add the `failureReason` column and migration
  - [x] 7.1 Add nullable `failureReason` to the `ScanJob` Prisma model and migrate
    - Add `failureReason String? @map("failure_reason")` to `ScanJob` in `apps/api/prisma/schema.prisma`
    - Generate migration `add_scanjob_failure_reason` and regenerate the Prisma client
    - _Requirements: 3.2, 11.2, 11.3, 11.6, 11.7_

- [x] 8. Wire `GitHubIngestionService` into `ScanService` and `ScanModule`
  - [x] 8.1 Register providers in `apps/api/src/scan/scan.module.ts`
    - Register `GitHubIngestionService` and the config provider/factory; inject into `ScanService`
    - _Requirements: 1.1, 5.1_

  - [x] 8.2 Add the `repository` branch in `ScanService.createScan`
    - Up-front guard: `sourceType === "repository"` with empty/missing `sourceRef` → `BadRequestException` (HTTP 400) (Req 1.2)
    - Translate synchronous validation `GitHubIngestionError` kinds (`invalid-url`, `not-a-repo-url`, `invalid-ref`) into HTTP 400 before queueing
    - Create the `ScanJob` (`sourceType="repository"`, `status="queued"`, `sourceRef=URL`), mkdir `scanDir`, call `githubIngestion.ingest(...)`, then enqueue `process-scan` with `{ scanId, scanDir }`
    - On ingestion failure: set `status="failed"`, set `failureReason` from the mapped error message, and remove `scanDir`; preserve existing `paste`/`upload`/`demo-sample` branches unchanged
    - Handle the optional explicit `scanRef` field (passed alongside URL-embedded ref) when present
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 11.2, 11.3, 11.5, 11.6, 11.7_

  - [x]\* 8.3 Write property test for token non-leakage
    - **Property 11: Token non-leakage**
    - **Validates: Requirements 9.4**
    - Generate random token strings, run mocked ingestion, and assert the token never appears in the persisted `ScanJob`, findings, API payloads, or captured logs; ≥100 runs

  - [x]\* 8.4 Write unit tests for the createScan repository branch
    - Empty URL → 400; invalid-url/invalid-ref → 400; successful ingest enqueues `process-scan`; ingestion failure sets `status=failed` + `failureReason` and cleans up `scanDir`
    - Assert `paste`/`upload`/`demo-sample` branches remain unchanged
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 11.5, 11.6_

- [x] 9. Implement secret redaction before AI review
  - [x] 9.1 Create `apps/api/src/scan/secret-redactor.ts`
    - Implement `redactSecrets(content)` reusing the `SecretAnalyzer` regex set; replace matched secret values with a fixed `***REDACTED***` token
    - Neutralize instruction-like content so repo text cannot override reviewer/system instructions (treat as untrusted data)
    - _Requirements: 10.1, 10.2_

  - [x] 9.2 Wire redaction into `apps/api/src/scan/scan.processor.ts`
    - Apply `redactSecrets` to each file's content in the array built just before `aiReviewer.reviewCode(...)`
    - Keep the step source-type-agnostic (always-safe) so the pipeline remains unbranched (Req 5.2)
    - On pipeline failure, set `failureReason` on the `ScanJob` (reuse column from task 7.1)
    - _Requirements: 10.1, 10.2, 10.3, 5.2_

  - [x]\* 9.3 Write property test for secret redaction
    - **Property 12: Secret redaction before AI review**
    - **Validates: Requirements 10.1**
    - Generate content embedding secrets from the pattern set; assert raw secret values absent from `redactSecrets` output; ≥100 runs

  - [x]\* 9.4 Write unit tests for AI untrusted-content handling
    - Content with "ignore previous instructions" passed as data is neutralized; malformed AI output rejected by zod before persistence
    - _Requirements: 10.2, 10.3_

- [~] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Standards mapping fallback
  - [x] 11.1 Add a documented fallback reference in `apps/api/src/rules/standards-mapper.ts`
    - Ensure `mapFindingToStandards` returns at least one valid `STANDARDS_REFERENCES` key for every finding (fallback when no specific match)
    - Preserve existing category rules (access-control → OWASP+API, injection → OWASP+CWE, secrets → CWE+NIST, accessibility → WCAG+ISO, maintainability → ISO+craftsmanship)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x]\* 11.2 Write property test for standards completeness
    - **Property 8: Standards completeness**
    - **Validates: Requirements 6.1, 6.7**
    - Generate random findings over `FindingCategoryEnum` × arbitrary text; assert ≥1 reference and every element is a valid `STANDARDS_REFERENCES` key; ≥100 runs

  - [x]\* 11.3 Write unit tests for standards category rules
    - Secret → CWE+NIST, injection → OWASP+CWE, access-control → OWASP+API, accessibility → WCAG+ISO, maintainability → ISO+craftsmanship
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 12. Verify scoring band and auto-block alignment
  - [x] 12.1 Verify/align score bands and auto-block override in `apps/api/src/scoring/scoring.service.ts`
    - Confirm `getScoreStatus` maps bands exactly (90–100 passed, 80–89 passed-with-warnings, 70–79 needs-cleanup, 60–69 risky, 0–59 blocked); fix only if a gap exists
    - Confirm a blocking/`AUTO_BLOCK_CONDITIONS` finding forces `statusResult="blocked"` and records a blocking reason; persist scores and `statusResult` on the `ScanJob`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x]\* 12.2 Write property test for score bands
    - **Property 9: Score-band correctness**
    - **Validates: Requirements 7.1, 7.2**
    - Generate integer scores `0..100`; assert exact (boundary-sensitive) band mapping; ≥100 runs

  - [x]\* 12.3 Write property test for auto-block override
    - **Property 10: Auto-block override**
    - **Validates: Requirements 7.3, 7.4, 7.5**
    - Generate finding sets seeded with ≥1 blocking/auto-block finding; assert `statusResult==="blocked"` regardless of computed score and a blocking reason is recorded; ≥100 runs

- [x] 13. Surface results and failure reason through the API
  - [x] 13.1 Return `failureReason` from `getScan`/`listScans` in `scan.service.ts` and `scan.controller.ts`
    - Include `failureReason`, scores, `statusResult`, and `sourceType=repository`/`sourceRef` in `GET /scans`, `GET /scans/:id`, and `GET /scans/:id/findings` using existing shared response schemas (no schema changes)
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 11.6_

  - [x]\* 13.2 Write unit tests for empty-repo and API surface
    - Empty repo: archive of only excluded/binary files → scan completes with 0 findings and a valid score, no crash
    - API: `repository` scan appears in `GET /scans` with correct `sourceType`/`sourceRef`; failed ingestion exposes `status=failed` + `failureReason`
    - _Requirements: 8.1, 8.2, 8.3, 11.4, 11.6_

- [x] 14. Integration tests
  - [x]\* 14.1 Write fixture-tarball end-to-end integration test
    - Commit a small `.tar.gz` fixture (a few `.ts`/`.tsx` files plus a `node_modules` dir and a binary) sourced as the tar stream (no network)
    - Run `GitHubIngestionService.ingest` → `FileClassifier` → `ScannerOrchestrator`; assert `AnalysisContext` is populated, findings are produced and mapped to standards, and `scanDir` is cleaned up afterward
    - _Requirements: 4.4, 5.2, 5.3, 5.4, 6.8_

  - [x]\* 14.2 Write scoring/auto-block end-to-end integration test
    - Use a hardcoded-secret fixture; assert the scan ends with `statusResult=blocked` and persisted scores
    - _Requirements: 7.4, 7.6_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP, but each maps a design property/requirement for traceability.
- Each task references specific requirement sub-clauses; property tests reference the exact design property number and the requirements clause they validate.
- Property tests use fast-check at ≥100 iterations and mock `fetch` (no real network); each is tagged `// Feature: github-repository-scanner, Property N`.
- Checkpoints (tasks 6, 10, 15) provide incremental validation breaks.
- Downstream pipeline components (`ScanProcessor` stages, `ScannerOrchestrator`, analyzers, `ScanGateway`) run unchanged once `scanDir` is populated.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "7.1", "11.1", "12.1"] },
    { "id": 1, "tasks": ["1.3", "2.1", "9.1", "11.2", "11.3", "12.2", "12.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.1", "9.2"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.1", "9.3", "9.4"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "5.1"] },
    { "id": 5, "tasks": ["5.2", "8.1"] },
    { "id": 6, "tasks": ["8.2", "13.1"] },
    { "id": 7, "tasks": ["8.3", "8.4", "13.2"] },
    { "id": 8, "tasks": ["14.1", "14.2"] }
  ]
}
```
