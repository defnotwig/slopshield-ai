# Requirements Document

## Introduction

This feature fixes two confirmed production issues on the SlopShield AI platform (NestJS backend on Render, Next.js frontend on Vercel):

1. **Connected GitHub repositories are not selectable in the UI.** The backend endpoint `GET /api/oauth/github/repos` works and returns the connected user's repositories, but the New Scan page never calls it. The "Git Repo" tab only offers a manual URL text input, so users who connected their GitHub account have no way to browse and pick a repository to scan. This feature adds a "Connected Repositories" picker to the Git Repo tab that, when GitHub is connected, loads the user's repositories and lets them select one to auto-fill the scan source. The manual URL input remains as a fallback.

2. **Repository scans fail with an unhelpful "exceeds the maximum allowed size" error.** The GitHub ingestion service aborts when a repository tarball exceeds `MAX_REPO_BYTES` (default 100 MB). The default is low and the error message is generic, giving the user no indication of the configured limit. This feature raises the default limit, keeps the limit configurable, improves the error message to state the configured limit, and surfaces the ingestion failure reason clearly in the frontend.

The scope is limited to the New Scan page repo tab, the GitHub ingestion size limit and its error message, and the frontend surfacing of the ingestion failure reason. No changes to the OAuth flow, the scan pipeline, or the repository fetch/extract security model are in scope.

## Glossary

- **New_Scan_Page**: The frontend page at `apps/web/src/app/scans/new/page.tsx` where a user configures and starts a scan.
- **Repo_Tab**: The "Git Repo" tab on the New_Scan_Page used to scan a remote Git repository.
- **Repo_Picker**: The new UI control on the Repo_Tab that lists the connected user's GitHub repositories for selection.
- **Connected_Account**: A record returned by `GET /api/oauth/accounts` describing a linked OAuth provider account, including `provider`, `displayName`, and `status`.
- **GitHub_Repos_Endpoint**: The backend endpoint `GET /api/oauth/github/repos` that returns the connected user's repositories as an array of `{ id, full_name, private, html_url }`.
- **Repository**: A GitHub repository object returned by the GitHub_Repos_Endpoint, with fields `id`, `full_name`, `private`, and `html_url`.
- **Source_Ref**: The repository reference string sent to the scan API as `sourceRef`; for a GitHub repository this is the repository clone/HTML URL.
- **Scan_API**: The backend endpoint `POST /api/scans` that creates a scan from `{ sourceType, sourceRef, scanMode, projectId? }`.
- **GitHub_Ingestion_Service**: The backend service at `apps/api/src/scan/github-ingestion.service.ts` that fetches and extracts a repository tarball.
- **Ingestion_Config**: The configuration loaded by `loadGitHubIngestionConfig` in `apps/api/src/scan/github-ingestion.config.ts`.
- **Max_Repo_Bytes**: The configurable maximum total byte count accepted while streaming a repository tarball (`MAX_REPO_BYTES`).
- **Too_Large_Error**: The `GitHubIngestionError` of kind `"too-large"` raised when a tarball exceeds Max_Repo_Bytes.
- **Failure_Reason**: The `failureReason` field persisted on a failed scan job and returned by the scan read APIs.
- **Scan_Progress_Page**: The frontend page at `apps/web/src/app/scans/[id]/progress/page.tsx` that displays scan status, including failures.
- **API_Client**: The typed HTTP client at `apps/web/src/lib/api-client.ts` exposing `get`, `post`, `put`, `patch`, and `delete`.

## Requirements

### Requirement 1: Detect GitHub connection on the Repo Tab

**User Story:** As a user who has connected my GitHub account, I want the New Scan page to recognize my connection, so that I can browse my repositories instead of typing a URL.

#### Acceptance Criteria

1. WHEN the Repo_Tab is displayed, THE New_Scan_Page SHALL request the connected accounts from `GET /api/oauth/accounts` through the API_Client.
2. WHERE a Connected_Account with `provider` equal to `"github"` and `status` equal to `"connected"` exists, THE New_Scan_Page SHALL treat GitHub as connected.
3. WHERE no Connected_Account with `provider` equal to `"github"` and `status` equal to `"connected"` exists, THE New_Scan_Page SHALL treat GitHub as not connected.
4. THE New_Scan_Page SHALL display the manual Source_Ref URL input on the Repo_Tab regardless of GitHub connection status.
5. WHILE the connected accounts request is in progress, THE New_Scan_Page SHALL display the manual Source_Ref URL input together with a loading indicator for the connection status on the Repo_Tab.

### Requirement 2: Load connected GitHub repositories

**User Story:** As a connected user, I want my GitHub repositories listed on the Repo Tab, so that I can pick one to scan without copying its URL.

#### Acceptance Criteria

1. WHEN GitHub is detected as connected on the Repo_Tab, THE New_Scan_Page SHALL request the repository list from the GitHub_Repos_Endpoint through the API_Client.
2. WHILE the repository list request is in progress, THE New_Scan_Page SHALL display a loading indicator in the Repo_Picker.
3. WHEN the repository list request succeeds, THE New_Scan_Page SHALL display each Repository in the Repo_Picker with its `full_name` and a visibility label derived from the `private` field.
4. WHERE a Repository has `private` equal to `true`, THE New_Scan_Page SHALL display the visibility label as `"Private"`.
5. WHERE a Repository has `private` equal to `false`, THE New_Scan_Page SHALL display the visibility label as `"Public"`.
6. IF the repository list request returns an empty array, THEN THE New_Scan_Page SHALL display a message stating that no repositories were found.
7. IF the repository list request fails, THEN THE New_Scan_Page SHALL display the error message returned by the API_Client in the Repo_Picker.

### Requirement 3: Select a repository to scan

**User Story:** As a connected user, I want to select a repository from the list, so that the scan source is filled in for me.

#### Acceptance Criteria

1. WHEN a user selects a Repository in the Repo_Picker, THE New_Scan_Page SHALL set the Source_Ref to that Repository's `html_url`.
2. WHEN a Repository is selected, THE New_Scan_Page SHALL visually indicate which Repository is currently selected by applying a selected style and setting `aria-pressed` to `true` on the selected Repository control, so the selection state is conveyed through an accessible attribute and not by color alone.
3. WHEN a user starts a scan with a Repository selected, THE New_Scan_Page SHALL send `POST /api/scans` with `sourceType` equal to `"repository"` and `sourceRef` equal to the selected Repository's `html_url`.
4. IF a user attempts to start a repository scan with neither a selected Repository nor a manual Source_Ref provided, THEN THE New_Scan_Page SHALL display a message requesting a repository selection or URL and SHALL NOT call the Scan_API.

### Requirement 4: Retain manual URL input as a fallback

**User Story:** As a user, I want to keep entering a repository URL manually, so that I can scan repositories that are not in my connected account list.

#### Acceptance Criteria

1. THE New_Scan_Page SHALL provide a manual Source_Ref URL input on the Repo_Tab regardless of GitHub connection status.
2. WHEN a user enters a value in the manual Source_Ref input, THE New_Scan_Page SHALL set the Source_Ref to the entered value.
3. WHEN a user starts a repository scan with a manual Source_Ref provided and no Repository selected, THE New_Scan_Page SHALL send `POST /api/scans` with `sourceRef` equal to the manually entered value.

### Requirement 5: Configurable and raised repository size limit

**User Story:** As a platform operator, I want a higher, configurable repository size limit, so that reasonably large repositories can be scanned without failing.

#### Acceptance Criteria

1. WHERE the `MAX_REPO_BYTES` environment variable is not set, THE Ingestion_Config SHALL set Max_Repo_Bytes to 262144000 bytes (250 MB).
2. WHERE the `MAX_REPO_BYTES` environment variable is set to an integer of at least 1048576 (1 MB), THE Ingestion_Config SHALL set Max_Repo_Bytes to that value.
3. IF the `MAX_REPO_BYTES` environment variable is set to a value below 1048576 (1 MB) or to a non-positive or non-numeric value, THEN THE Ingestion_Config SHALL set Max_Repo_Bytes to the default of 262144000 bytes (250 MB).
4. WHEN the cumulative streamed byte count exceeds Max_Repo_Bytes, THE GitHub_Ingestion_Service SHALL abort the fetch and raise the Too_Large_Error.

### Requirement 6: Informative too-large error message

**User Story:** As a user scanning a large repository, I want the size error to state the limit, so that I understand why the scan failed.

#### Acceptance Criteria

1. WHEN the GitHub_Ingestion_Service raises the Too_Large_Error, THE GitHub_Ingestion_Service SHALL include the configured Max_Repo_Bytes value, expressed in megabytes, in the error message.
2. WHEN the GitHub_Ingestion_Service raises the Too_Large_Error, THE GitHub_Ingestion_Service SHALL set the error message to indicate that the repository exceeds the configured size limit.

### Requirement 7: Surface ingestion failure reason in the frontend

**User Story:** As a user whose scan failed, I want to see the actual failure reason, so that I can take corrective action.

#### Acceptance Criteria

1. WHERE a scan has `status` equal to `"failed"` and a non-empty Failure_Reason, THE Scan_Progress_Page SHALL display the Failure_Reason text.
2. WHERE a scan has `status` equal to `"failed"` and an empty or absent Failure_Reason, THE Scan_Progress_Page SHALL display a generic scan failure message.
