# Requirements Document

## Introduction

This feature ships the SlopShield AI frontend (`apps/web`) to Vercel quickly and safely, well before the NestJS backend and its supporting services (PostgreSQL, Redis/BullMQ, Socket.IO, scanner plugins, Gemini, Lark) are deployed. The web app must render every page using clearly labeled mock/demo data when no backend is configured (the default mode), and transparently switch to a real backend when `NEXT_PUBLIC_API_MODE=live` and `NEXT_PUBLIC_API_URL` are provided.

The approach is additive: a Config Module decides the runtime mode, a Mock Data Module supplies typed demo payloads, a Mock Path Resolver maps REST-style request paths to those payloads, the existing API Client is extended to route to mock data without touching the network, and a Mock-Mode Banner labels the deploy honestly. The build must never fail because backend environment variables are missing, mock mode must perform no network I/O, the hook surface must remain stable, mock data must be schema-valid, live configuration must fail safely, and Vercel monorepo settings must support the `apps/web` deployment.

## Glossary

- **Web_App**: The SlopShield AI frontend application located at `apps/web` (`@slopshield/web`).
- **Config_Module**: The module at `apps/web/src/lib/config.ts` that resolves runtime mode and app metadata from `NEXT_PUBLIC_*` environment variables.
- **API_Client**: The module at `apps/web/src/lib/api-client.ts` exposing `apiClient.get/post/patch/delete` and `ApiError`.
- **Mock_Resolver**: The internal module at `apps/web/src/lib/mock-resolver.ts` that maps REST-style paths to mock payloads via ordered pattern matching.
- **Mock_Data_Module**: The module at `apps/web/src/lib/mock-data.ts` providing deterministic demo payloads typed against `@slopshield/shared`.
- **Mock_Mode_Banner**: The component at `apps/web/src/components/mock-mode-banner.tsx` that visibly labels demo mode.
- **Api_Mode**: The runtime mode, one of `"mock"` or `"live"`.
- **Mock_Mode**: The state where `Api_Mode` is `"mock"` (`config.isMock === true`).
- **Live_Mode**: The state where `Api_Mode` is `"live"`.
- **ApiError**: The error type thrown by `API_Client` carrying a numeric `statusCode` and a message.
- **Shared_Schemas**: The Zod schemas exported by `@slopshield/shared` (`ScanJobSchema`, `FindingSchema`, `ScanScoreSchema`, `LarkScanSummarySchema`, `RuleSchema`).
- **Hook_Path**: A REST-style request path emitted by an existing TanStack Query hook (e.g. `/scans?page=1&limit=10`, `/scans/:id`, `/dashboard/summary`).
- **Build_Process**: The Next.js production build of the `Web_App` (`next build`).

## Requirements

### Requirement 1: Runtime Mode Resolution

**User Story:** As a developer, I want the application to resolve its runtime mode from environment variables with a safe default, so that the app runs in demo mode whenever a backend is not configured.

#### Acceptance Criteria

1. WHEN the `Config_Module` is imported AND `NEXT_PUBLIC_API_MODE` is unset, THE `Config_Module` SHALL resolve `Api_Mode` to `"mock"`.
2. WHEN the `Config_Module` is imported AND `NEXT_PUBLIC_API_MODE` equals `"live"` (case-insensitive, trimmed), THE `Config_Module` SHALL resolve `Api_Mode` to `"live"`.
3. IF `NEXT_PUBLIC_API_MODE` holds any value other than `"live"` after trimming and lowercasing, THEN THE `Config_Module` SHALL resolve `Api_Mode` to `"mock"`.
4. WHEN `Api_Mode` resolves to `"mock"`, THE `Config_Module` SHALL set `isMock` to `true`.
5. WHEN `Api_Mode` resolves to `"live"`, THE `Config_Module` SHALL set `isMock` to `false`.
6. THE `Config_Module` SHALL expose `apiUrl` as the trimmed value of `NEXT_PUBLIC_API_URL`, defaulting to an empty string when unset.
7. THE `Config_Module` SHALL expose `appName` as the trimmed value of `NEXT_PUBLIC_APP_NAME`, defaulting to `"SlopShield AI"` when unset.

### Requirement 2: No Network Access in Mock Mode

**User Story:** As a developer deploying a demo, I want the app to never reach out to a backend in mock mode, so that the deploy works with no backend present and no network egress.

#### Acceptance Criteria

1. WHILE `Mock_Mode` is active, WHEN any `API_Client` method is invoked for any path and method, THE `API_Client` SHALL resolve the response from the `Mock_Resolver` without calling `fetch`.
2. WHILE `Mock_Mode` is active, WHEN an `API_Client` request is made, THE `API_Client` SHALL return a typed payload supplied by the `Mock_Data_Module`.

### Requirement 3: Hook Surface Stability

**User Story:** As a frontend developer, I want every REST path the existing hooks emit to resolve to mock data, so that no page breaks in mock mode and the existing hooks require no changes.

#### Acceptance Criteria

1. THE `API_Client` SHALL preserve the public surface `get`, `post`, `patch`, and `delete` together with the `ApiError` type.
2. WHEN a `Hook_Path` from the set `/scans`, `/scans/:id`, `/scans/:id/findings`, `/dashboard/summary`, `/dashboard/trends`, `/dashboard/top-issues`, `/dashboard/standards`, `/projects`, `/projects/:id`, `/rules`, `/auth/me`, `/users/notifications` is requested in `Mock_Mode`, THE `Mock_Resolver` SHALL return a defined mock payload for that path.
3. WHEN a `GET` request is made to a path that matches no `Mock_Resolver` route, THE `Mock_Resolver` SHALL throw an `ApiError` with `statusCode` equal to `404`.
4. WHEN a `POST`, `PATCH`, or `DELETE` request is made to a path that matches no `Mock_Resolver` route, THE `Mock_Resolver` SHALL return `undefined` as a no-op.
5. WHEN a `GET` request is made to `/scans` with `page` and `limit` query parameters, THE `Mock_Resolver` SHALL return a paginated envelope containing at most `limit` rows along with the requested `page`, `limit`, and the total row count.
6. WHEN a `GET` request to `/scans` or `/scans/:id/findings` includes filter query parameters, THE `Mock_Resolver` SHALL return only rows matching every supplied filter.

### Requirement 4: Mock Data Schema Validity

**User Story:** As a developer, I want all shared-typed mock data to validate against the shared schemas, so that demo payloads are structurally identical to real backend responses.

#### Acceptance Criteria

1. THE `Mock_Data_Module` SHALL provide mock literals for scan jobs, findings, scan scores, Lark scan summaries, and rules that each parse successfully against their corresponding `Shared_Schemas`.
2. THE `Mock_Data_Module` SHALL provide at least three scan jobs spanning multiple statuses and verdicts.
3. THE `Mock_Data_Module` SHALL ensure dashboard aggregate values are internally consistent with the mock scan and finding data.
4. THE `Mock_Data_Module` SHALL use fixed ISO timestamp strings rather than a runtime clock so that rendered output is deterministic.

### Requirement 5: Live Configuration Safety

**User Story:** As an operator enabling live mode, I want a clear, early error when the backend URL is missing, so that I never issue requests against a malformed URL and the failure is easy to diagnose.

#### Acceptance Criteria

1. IF `Api_Mode` is `"live"` AND `apiUrl` is an empty string, WHEN an `API_Client` request is made, THEN THE `API_Client` SHALL throw a descriptive error and SHALL NOT call `fetch`.
2. WHILE `Live_Mode` is active AND `apiUrl` is non-empty, WHEN an `API_Client` request is made, THE `API_Client` SHALL send the request to `apiUrl` concatenated with the request path.
3. WHILE `Live_Mode` is active, WHEN a request returns HTTP status `204`, THE `API_Client` SHALL return `undefined`.
4. WHILE `Live_Mode` is active, WHEN a request returns a non-OK HTTP status, THE `API_Client` SHALL throw an `ApiError` carrying the response status code and message.
5. WHILE `Live_Mode` is active AND an authentication token is present in browser storage, WHEN an `API_Client` request is made, THE `API_Client` SHALL attach the token as an `Authorization` bearer header.

### Requirement 6: Build Determinism and Resilience

**User Story:** As a developer, I want the build to succeed with no backend environment variables set, so that the frontend can be deployed to Vercel without any backend configuration.

#### Acceptance Criteria

1. WHEN the `Config_Module` is imported with all `NEXT_PUBLIC_*` variables unset, THE `Config_Module` SHALL complete import without throwing.
2. WHEN the `Mock_Data_Module` is imported with all `NEXT_PUBLIC_*` variables unset, THE `Mock_Data_Module` SHALL complete import without throwing.
3. WHEN the `Build_Process` runs with no backend environment variables set, THE `Build_Process` SHALL complete with a success exit code.
4. WHEN the `Build_Process` runs with no backend environment variables set, THE `Web_App` SHALL resolve to `Mock_Mode`.

### Requirement 7: Visible Demo-Mode Banner

**User Story:** As a viewer of the deployed demo, I want a visible label indicating the data is not from a real backend, so that no one mistakes the demo for a production-ready deployment.

#### Acceptance Criteria

1. WHILE `Mock_Mode` is active, THE `Mock_Mode_Banner` SHALL render a visible label indicating that demo data is shown and the backend is not connected.
2. WHILE `Live_Mode` is active, THE `Mock_Mode_Banner` SHALL render nothing.

### Requirement 8: Vercel Monorepo Deployment Configuration

**User Story:** As an operator, I want documented Vercel project settings for the monorepo, so that the `apps/web` app builds and deploys correctly without pulling in backend code.

#### Acceptance Criteria

1. THE deployment configuration SHALL specify `apps/web` as the Vercel project root directory.
2. THE deployment configuration SHALL run `pnpm install` at the repository root so that the `@slopshield/shared` workspace dependency resolves.
3. THE deployment configuration SHALL declare `@slopshield/shared` in `transpilePackages` so that Next transpiles its TypeScript source at build time.
4. THE `Web_App` SHALL NOT import server-only backend code, Prisma, Redis, or BullMQ.
5. THE deployment configuration SHALL set `NEXT_PUBLIC_API_MODE` to `mock` for production and preview environments in this milestone.
