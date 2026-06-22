# Implementation Plan: vercel-fast-deploy

## Overview

This plan ships the SlopShield AI frontend (`apps/web`) to Vercel in mock mode by default, with a live-mode switch. The work is additive: a config module resolves runtime mode, a mock-data module supplies typed demo payloads, a mock-resolver maps REST paths to those payloads, the existing `apiClient` is extended to short-circuit to mock data, and a banner labels the demo honestly. Each step builds on the previous one and ends with wiring the banner into the layout and verifying a backend-free build.

Language: **TypeScript** (matches the existing `apps/web` codebase, `@/*` alias). Tests use **Vitest** + **fast-check** + **React Testing Library**.

## Tasks

- [x] 1. Set up frontend test tooling
  - [x] 1.1 Add Vitest + fast-check test harness to `apps/web`
    - Add `vitest`, `fast-check`, `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` as devDependencies in `apps/web/package.json`
    - Create `apps/web/vitest.config.ts` with the `jsdom` environment and the `@/*` path alias resolved to `src/*`
    - Add `test` and `test:run` scripts (use `vitest run` for single-execution CI runs)
    - _Requirements: 6.3_

- [x] 2. Implement the config module
  - [x] 2.1 Create `apps/web/src/lib/config.ts`
    - Define `ApiMode` and `AppConfig` types and the `resolveMode` helper (any value other than trimmed/lowercased `"live"` falls back to `"mock"`)
    - Build and export the `config` object reading `NEXT_PUBLIC_API_MODE`, `NEXT_PUBLIC_API_URL` (trimmed, default `""`), and `NEXT_PUBLIC_APP_NAME` (trimmed, default `"SlopShield AI"`); set `isMock` from `apiMode`
    - Export `assertLiveConfig` that throws a descriptive error only when `apiMode === "live"` and `apiUrl` is empty; never throw at import time
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 6.1_

  - [x] 2.2 Write property test for build determinism of config import
    - **Property 5: Build determinism**
    - **Validates: Requirements 6.1**

  - [x] 2.3 Write unit tests for mode resolution and live guard
    - Table-test `undefined`/`""`/`"mock"`/`"LIVE"`/`" live "`/garbage to expected `apiMode`/`isMock`
    - Assert `assertLiveConfig` throws only for `live` + empty URL and stays silent otherwise
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 5.1_

- [x] 3. Implement the mock-data module
  - [x] 3.1 Create `apps/web/src/lib/mock-data.ts`
    - Define the frontend-local shapes (`PaginatedScans`, `DashboardSummary`, `DashboardTrendPoint`, `TopIssue`, `StandardCompliance`, `Project`, `NotificationSettings`, `DemoUser`)
    - Provide at least three scan jobs spanning multiple statuses and verdicts, findings keyed by scan id, category scores, scan scores, a Lark summary preview, projects, rules, notification settings, and a demo user — all typed against `@slopshield/shared`
    - Use fixed ISO timestamp strings (no runtime clock); ensure dashboard aggregates are internally consistent with the mock scans/findings (e.g. `totalScans === mockScanJobs.length`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 6.2_

  - [x] 3.2 Write property test for mock data schema validity
    - **Property 3: Schema validity**
    - **Validates: Requirements 4.1**

  - [x] 3.3 Write unit tests for data consistency and determinism
    - Assert dashboard aggregates match the mock scan/finding set and timestamps are fixed ISO strings
    - Assert importing the module with all `NEXT_PUBLIC_*` unset does not throw
    - _Requirements: 4.2, 4.3, 4.4, 6.2_

- [x] 4. Checkpoint - config and data foundations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the mock path resolver
  - [x] 5.1 Create `apps/web/src/lib/mock-resolver.ts`
    - Implement `compile` (pattern with `:params` to regex + ordered keys) and the ordered `routes` table covering `/scans`, `/scans/:id`, `/scans/:id/findings`, `/scans` POST, `/scans/:id/cancel`, `/dashboard/*`, `/projects`, `/projects/:id`, `/rules`, `/auth/me`, `/users/notifications`
    - Implement `resolveMock(method, path, body)`: split pathname/query, match the first route, extract params, apply pagination to `/scans` (at most `limit` rows plus `page`/`limit`/`total`) and filtering to `/scans` and `/scans/:id/findings`
    - Throw `ApiError(404, ...)` for unmatched GETs; return `undefined` for unmatched mutations
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 5.2 Write property test for hook surface stability
    - **Property 2: Hook surface stability**
    - **Validates: Requirements 3.2, 3.3**

  - [x] 5.3 Write unit tests for resolver routing, pagination, and filtering
    - Assert each known hook path resolves to a payload of the expected shape
    - Assert `/scans` pagination math, param extraction for `/scans/:id`, query filtering for findings, `404` for unknown GET, and no-op `undefined` for unknown mutation
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 6. Extend the API client
  - [x] 6.1 Modify `apps/web/src/lib/api-client.ts`
    - Preserve the public surface (`apiClient.get/post/patch/delete` and `ApiError`)
    - In mock mode, short-circuit through `resolveMock` (with a small artificial delay) and never call `fetch`
    - In live mode, call `assertLiveConfig()` first, read the base URL from `config.apiUrl`, attach the bearer token from browser storage when present, handle `204` as `undefined`, and throw `ApiError` on non-OK responses
    - _Requirements: 2.1, 2.2, 3.1, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 6.2 Write property test for no network access in mock mode
    - **Property 1: No network in mock mode**
    - **Validates: Requirements 2.1, 2.2**

  - [x] 6.3 Write property test for live config safety
    - **Property 4: Live config safety**
    - **Validates: Requirements 5.1**

  - [x] 6.4 Write unit tests for live-mode request behavior
    - Spy on `fetch`: assert URL concatenation, bearer header attachment, `204` to `undefined`, and `ApiError` on non-OK status
    - _Requirements: 3.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7. Checkpoint - mock routing and client wiring
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement and wire the mock-mode banner
  - [x] 8.1 Create `apps/web/src/components/mock-mode-banner.tsx`
    - Render a visible "Demo data — backend not connected" label when `config.isMock` is true; render nothing in live mode
    - _Requirements: 7.1, 7.2_

  - [x] 8.2 Wire the banner into `apps/web/src/app/layout.tsx`
    - Conditionally render `<MockModeBanner />` based on `config.isMock` so every page shows the demo label in mock mode
    - _Requirements: 7.1_

  - [x] 8.3 Write integration tests for banner and no-fetch rendering
    - Render dashboard/scans content with `config.isMock = true`, spy on `globalThis.fetch`, and assert zero calls
    - Assert banner presence in mock mode and absence in live mode
    - _Requirements: 2.1, 7.1, 7.2_

- [x] 9. Configure Vercel monorepo deployment
  - [x] 9.1 Verify and document `apps/web` Next config and Vercel settings
    - Confirm `transpilePackages: ["@slopshield/shared"]` in `apps/web/next.config.ts`; ensure no server-only/backend, Prisma, Redis, or BullMQ imports exist in the web app
    - Add a deployment doc/section capturing Root Directory `apps/web`, root `pnpm install`, Node 20.x, and `NEXT_PUBLIC_API_MODE=mock` for production/preview
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 10. Final checkpoint - backend-free build verification
  - Run `pnpm --filter @slopshield/web typecheck` and `pnpm --filter @slopshield/web build` with no backend env vars set; confirm exit code 0 and mock-mode resolution
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 6.3, 6.4_

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP.
- Each task references specific requirements clauses for traceability.
- Property tests validate the five universal correctness properties from the design; unit and integration tests cover examples and edge cases.
- Checkpoints ensure incremental validation as the additive layer is built up.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "3.2", "3.3", "5.1", "8.1", "9.1"] },
    { "id": 2, "tasks": ["5.2", "5.3", "6.1", "8.2"] },
    { "id": 3, "tasks": ["6.2", "6.3", "6.4", "8.3"] }
  ]
}
```
