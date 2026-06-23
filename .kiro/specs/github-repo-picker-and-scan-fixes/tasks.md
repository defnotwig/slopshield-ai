# Implementation Plan: GitHub Repo Picker and Scan Fixes

## Overview

This plan implements three fixes in incremental, integrated steps using TypeScript across the NestJS backend (`apps/api`) and the Next.js frontend (`apps/web`):

1. Backend ingestion config: raised, validated, configurable `MAX_REPO_BYTES` and an informative too-large error message.
2. Frontend OAuth read hooks (`useConnectedAccounts`, `useGitHubRepos`) plus the `isGitHubConnected` predicate.
3. Repo picker UI on the New Scan page's Git Repo tab, wired to the scan submit flow, with the manual URL fallback retained.
4. Surfacing the real ingestion failure reason on the scan progress page.

Each step builds on the previous and ends wired into the running app. Property tests follow the four correctness properties in the design and use fast-check (min 100 iterations).

## Tasks

- [ ] 1. Backend: validated, raised repository size limit
  - [ ] 1.1 Implement `parseMaxRepoBytes` and raised default in ingestion config
    - In `apps/api/src/scan/github-ingestion.config.ts`, add `DEFAULT_MAX_REPO_BYTES = 262_144_000` and `MIN_MAX_REPO_BYTES = 1_048_576`
    - Add `parseMaxRepoBytes(raw: string | undefined): number` returning the parsed integer when it is an integer `>= 1 MB`, else the 250 MB default (covers unset, non-numeric `NaN`, non-integer, non-positive, empty string `0`, and below-1 MB cases)
    - Use `parseMaxRepoBytes(process.env.MAX_REPO_BYTES)` in `loadGitHubIngestionConfig` to set `maxRepoBytes`; leave other config fields unchanged
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 1.2 Write property test for repository size limit parsing
    - **Property 2: Repository size limit parsing**
    - File: `apps/api/src/scan/github-ingestion.config.property.spec.ts`, fast-check, min 100 iterations
    - Generate unset, non-numeric strings, non-integers, values `< 1 MB`, non-positive values, and integers `>= 1 MB`; assert `parseMaxRepoBytes` returns the input for valid integers and the 250 MB default otherwise
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 1.3 Write unit tests for `parseMaxRepoBytes` boundaries
    - Boundary cases: exactly `1048576`, `1048575`, `0`, `-1`, `"abc"`, `""`, and unset
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 2. Backend: informative too-large error message
  - [ ] 2.1 Rebuild the too-large error message from configured limit
    - In `apps/api/src/scan/github-ingestion.service.ts`, in the `fetchTarball` too-large path, compute `maxMb = Math.floor(max / (1024 * 1024))` from `this.config.maxRepoBytes`
    - Set the `GitHubIngestionError("too-large", ...)` message to state the repository exceeds the configured size limit and include the limit in MB
    - Leave the byte-cap enforcement (`received > max` abort) and error kind unchanged
    - _Requirements: 6.1, 6.2, 5.4_

  - [ ]* 2.2 Write property test for too-large error message
    - **Property 3: Too-large error states the configured limit**
    - File: `apps/api/src/scan/github-ingestion.service.property.spec.ts`, fast-check, min 100 iterations
    - For random valid `maxRepoBytes`, assert the too-large error message contains `floor(maxRepoBytes / 1048576)` MB and the "configured size limit" phrasing (unit-test the message builder or trigger the too-large stream path)
    - **Validates: Requirements 6.1, 6.2**

- [ ] 3. Checkpoint - backend ingestion changes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Frontend: OAuth read hooks and connection predicate
  - [ ] 4.1 Add `useConnectedAccounts`, `isGitHubConnected`, and `useGitHubRepos`
    - In `apps/web/src/hooks/use-oauth.ts`, add `ConnectedAccount` and `GitHubRepo` interfaces
    - Add `useConnectedAccounts()` wrapping `apiClient.get<ConnectedAccount[]>("/oauth/accounts")` with query key `["oauth", "accounts"]` (mirror `useProjects`)
    - Add `isGitHubConnected(accounts)` returning true iff an account has `provider === "github"` and `status === "connected"`
    - Add `useGitHubRepos(enabled: boolean)` wrapping `apiClient.get<GitHubRepo[]>("/oauth/github/repos")` with query key `["oauth", "github", "repos"]` and the `enabled` flag
    - _Requirements: 1.1, 1.2, 1.3, 2.1_

  - [ ]* 4.2 Write property test for GitHub connection detection
    - **Property 1: GitHub connection detection**
    - File: `apps/web/src/hooks/use-oauth.property.test.ts`, fast-check, min 100 iterations
    - Generate random account arrays (varying provider/status, including github-but-not-connected and connected-but-not-github); assert `isGitHubConnected` equals existence of a qualifying account
    - **Validates: Requirements 1.2, 1.3**

  - [ ]* 4.3 Write unit tests for the OAuth hooks
    - Assert `useConnectedAccounts` calls `/oauth/accounts`; `useGitHubRepos` only fires when `enabled` is true and calls `/oauth/github/repos`
    - _Requirements: 1.1, 2.1_

- [ ] 5. Frontend: RepoPicker and connection-aware Git Repo tab
  - [ ] 5.1 Add `visibilityLabel` helper and RepoPicker block to the repo tab
    - In `apps/web/src/app/scans/new/page.tsx`, add `visibilityLabel(isPrivate: boolean)` returning `"Private"` for true and `"Public"` for false
    - Call `useConnectedAccounts`; derive `connected = isGitHubConnected(data)`; while loading show a connection-status loading indicator with the manual URL input still visible
    - Render the RepoPicker only when connected, above the existing manual URL input; call `useGitHubRepos(connected)`
    - Picker states: loading spinner; error → render `error.message`; empty array → "No repositories found"; success → list of native `<button>` items showing `full_name` and `visibilityLabel(private)`
    - Always render the manual Source_Ref URL input regardless of connection status
    - _Requirements: 1.4, 1.5, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.1_

  - [ ] 5.2 Wire repository selection state into the repo tab
    - Add `selectedRepoId: number | null` state; selecting a repo sets `selectedRepoId` and `sourceRef = repo.html_url`
    - Apply selected styling and `aria-pressed={selected}` on each repo `<button>` so selection is conveyed accessibly, not by color alone
    - Editing the manual input updates `sourceRef` and clears `selectedRepoId`
    - _Requirements: 3.1, 3.2, 4.2_

  - [ ] 5.3 Wire repo-tab submit logic to sourceRef
    - On start: if `sourceRef.trim()` is empty, show "Please select a repository or provide a URL." and do not call the Scan_API
    - Otherwise `POST /api/scans` with `sourceType: "repository"`, `sourceRef`, `scanMode`, optional `projectId` (covers both selected-repo `html_url` and manual value)
    - _Requirements: 3.3, 3.4, 4.3_

  - [ ]* 5.4 Write component tests for the repo tab and picker
    - Manual input renders in connected/disconnected/loading states (Req 1.4, 1.5, 4.1); accounts query fires on render (Req 1.1); repos query fires only when connected (Req 2.1)
    - Picker loading/empty/error states (Req 2.2, 2.6, 2.7); `full_name` + visibility labels (Req 2.3–2.5)
    - Selecting a repo sets `sourceRef` to `html_url` with `aria-pressed="true"` and selected style (Req 3.1, 3.2)
    - Submit posts `sourceType: "repository"` with selected `html_url` (Req 3.3) or manual value (Req 4.3); manual edit updates `sourceRef` (Req 4.2); empty/whitespace + no selection shows validation message and does not call the API (Req 3.4)
    - _Requirements: 1.1, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3_

- [ ] 6. Checkpoint - frontend repo picker
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Frontend: surface ingestion failure reason on progress page
  - [ ] 7.1 Render `scan.failureReason` in the failed state
    - In `apps/web/src/app/scans/[id]/progress/page.tsx`, when `status === "failed"` and `scan.failureReason` is a non-empty (non-whitespace) string, display that text
    - Otherwise (failed with empty, whitespace-only, or absent reason) display the existing generic failure message
    - _Requirements: 7.1, 7.2_

  - [ ]* 7.2 Write property test for failed-scan message selection
    - **Property 4: Failed-scan message selection**
    - File: `apps/web/src/app/scans/[id]/progress/progress.property.test.tsx`, fast-check, min 100 iterations
    - Render the failed state with random `failureReason` values (non-empty, empty, whitespace, undefined); assert the reason is shown when non-empty and the generic message otherwise
    - **Validates: Requirements 7.1, 7.2**

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Property tests use fast-check with a minimum of 100 iterations and are tagged with `// Feature: github-repo-picker-and-scan-fixes, Property {number}: {property_text}`.
- Backend property tests live under `apps/api/src/scan/`; frontend tests are colocated under `apps/web/src/`.
- The streaming byte-cap enforcement (Req 5.4) is already covered by the existing `github-ingestion.resource-bounds.property.spec.ts`; this plan only updates the default, parsing, and message.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "7.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "4.2", "4.3", "7.2"] },
    { "id": 2, "tasks": ["2.2", "5.1"] },
    { "id": 3, "tasks": ["5.2"] },
    { "id": 4, "tasks": ["5.3"] },
    { "id": 5, "tasks": ["5.4"] }
  ]
}
```
