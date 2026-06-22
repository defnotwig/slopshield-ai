# Implementation Plan: Backend Hosting & Live Mode

## Overview

This plan deploys the SlopShield AI backend (`apps/api`) to a Render Free Web Service backed by Neon PostgreSQL and Upstash Redis, and flips the Vercel frontend (`apps/web`) from mock to live mode. The work is mostly small, targeted TypeScript changes plus committed configuration (`render.yaml`) and a deployment document.

The plan front-loads the pure, testable helpers (`common/env.ts`, `common/redis.ts`) so the six correctness properties can be exercised early, then wires them into the Nest bootstrap, BullMQ factory, scan worker, and frontend query client, and finishes with the committed provisioning blueprint and deployment doc. Tests use the API's existing Jest + `fast-check` setup and the web app's test setup, keeping CI (`.github/workflows/ci.yml`) green.

## Tasks

- [x] 1. Implement pure helper utilities (port, env, file-cap, Redis)
  - [x] 1.1 Create `apps/api/src/common/env.ts` with `resolvePort`, `findMissingEnv`, `capFiles`, and `maxAnalyzeFiles`
    - `resolvePort(env)`: return `PORT` when a valid positive integer, else `API_PORT` when valid, else `3001`
    - `findMissingEnv(env)`: in `production` return required vars (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGIN`) that are absent or blank; empty list otherwise
    - `capFiles(files, max)`: return at most `max` elements as an order-preserving prefix (`max < 0` returns all)
    - `maxAnalyzeFiles()`: read `MAX_ANALYZE_FILES` env with default `50`
    - _Requirements: 2.1, 2.2, 2.3, 8.4, 12.1_

  - [x] 1.2 Write property test for `resolvePort`
    - **Property 1: Port precedence**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Generators: `{ PORT?, API_PORT? }` with numeric, empty, non-numeric, and absent values; min 100 iterations
    - Tag: `// Feature: backend-hosting-live-mode, Property 1: Port precedence`

  - [x] 1.3 Write property test for `findMissingEnv`
    - **Property 6: Missing-required-env detection in production**
    - **Validates: Requirements 12.1**
    - Generators: env objects with random subsets of required keys removed; `NODE_ENV` prod vs non-prod; min 100 iterations
    - Tag: `// Feature: backend-hosting-live-mode, Property 6`

  - [x] 1.4 Write property test for `capFiles`
    - **Property 5: Heavy-analyzer file cap is bounded and order-preserving**
    - **Validates: Requirements 8.4**
    - Generators: random arrays + non-negative caps including `0` and cap > length; min 100 iterations
    - Tag: `// Feature: backend-hosting-live-mode, Property 5`

  - [x] 1.5 Create `apps/api/src/common/redis.ts` with `buildRedisConnection`
    - Parse `REDIS_URL` into `host`, `port` (default `6379` when omitted), `password` (omit when absent), `maxRetriesPerRequest: null`
    - Set `tls: {}` if and only if the scheme is `rediss:`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 1.6 Write property test for `buildRedisConnection`
    - **Property 2: Redis URL → connection derivation and TLS decision**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
    - Generators: URLs varying scheme (`redis:`/`rediss:`), explicit/omitted port, with/without password, random hosts; min 100 iterations
    - Tag: `// Feature: backend-hosting-live-mode, Property 2`

- [x] 2. Add the health endpoint module
  - [x] 2.1 Create `apps/api/src/health/health.controller.ts` and `health.module.ts`
    - `@Controller("health")` with a `@Get()` `check()` returning `{ status: "ok", timestamp, uptime }` (public; no `@UseGuards`)
    - `HealthModule` declaring the controller
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Write unit test for `HealthController.check()`
    - Assert returns `{ status: "ok", timestamp, uptime }` shape
    - _Requirements: 1.3_

- [x] 3. Wire bootstrap and module configuration
  - [x] 3.1 Update `apps/api/src/main.ts` for PORT resolution and boot-time env validation
    - Call `findMissingEnv()` before listening; log a descriptive error naming each missing variable and throw to abort boot
    - Use `resolvePort()` for the listen port, bind `0.0.0.0`, and keep the existing port log line
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 12.1_

  - [x] 3.2 Write unit test for bootstrap port logging and missing-env abort
    - Spy on `Logger` to assert the chosen port is logged (2.4) and that missing required env throws before listen (12.1)
    - _Requirements: 2.4, 12.1_

  - [x] 3.3 Update `apps/api/src/app.module.ts` Redis factory and register `HealthModule`
    - Replace the inline `REDIS_URL` parsing in `BullModule.forRootAsync` with `buildRedisConnection(...)`
    - Add `HealthModule` to `AppModule.imports`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 3.4 Add connection error logging for Prisma and Redis
    - Wrap `PrismaService.onModuleInit` `$connect()` in try/catch logging a descriptive DB connection error (host redacted)
    - Attach an ioredis/BullMQ `error` listener that logs a descriptive Redis connection error
    - _Requirements: 12.2, 12.3_

  - [x] 3.5 Write unit tests for Prisma/Redis connection error logging
    - Mock-based: assert a descriptive log is emitted on connect rejection
    - _Requirements: 12.2, 12.3_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add scan worker free-tier guardrails
  - [x] 5.1 Add the analyzer timeout wrapper to `apps/api/src/scanner/scanner.orchestrator.ts`
    - Add `runWithTimeout` that races `analyzer.analyze()` against `ANALYZER_TIMEOUT_MS` (default `45000`) and resolves (never rejects) to a failed `AnalysisResult` on timeout
    - Call `runWithTimeout` from `runAll`, retaining the existing `try/catch` + `Promise.allSettled` + `isAvailable()` gating
    - _Requirements: 8.3, 8.5_

  - [x] 5.2 Write property test for graceful analyzer degradation
    - **Property 4: Analyzer timeout/failure degrades gracefully**
    - **Validates: Requirements 8.3, 8.5**
    - Generators: arrays of mock analyzers (fast-success / throw / unavailable / hang) with fake timers; findings equal the union of fast-succeeding analyzers; min 100 iterations
    - Tag: `// Feature: backend-hosting-live-mode, Property 4`

  - [x] 5.3 Set worker concurrency and heavy-analyzer file cap in `apps/api/src/scan/scan.processor.ts`
    - Set `@Processor("scan-pipeline", { concurrency: 1 })`
    - Use `capFiles(..., maxAnalyzeFiles())` for the heavy-analyzer file list and replace the hard-coded `.slice(0, 10)` for AI review
    - _Requirements: 8.1, 8.2, 8.4, 8.6_

  - [x] 5.4 Write unit tests for processor concurrency and AI-absent behavior
    - Assert `@Processor` options expose `concurrency: 1` (8.2); processor still persists static findings when `GEMINI_API_KEY` is absent (8.6); orchestrator registers the expected analyzer suite (8.1)
    - _Requirements: 8.1, 8.2, 8.6_

- [x] 6. Add frontend cold-start tolerance
  - [x] 6.1 Update `apps/web/src/lib/query-client.ts` retry policy
    - Set `retry: 3` and an exponential `retryDelay` (`Math.min(1000 * 2 ** attempt, 15000)`) so the first request survives a ~1 min Render cold start while showing a loading state
    - _Requirements: 9.1, 9.2_

  - [x] 6.2 Write unit test for QueryClient retry defaults
    - Assert default `retry` resolves to ≥1 and `retryDelay` increases with attempt
    - _Requirements: 9.2_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Add provisioning blueprint and live base-path verification
  - [x] 8.1 Create `render.yaml` at the repository root
    - `type: web`, `runtime: node`, `plan: free`, `rootDir: .`, `healthCheckPath: /api/health`, `NODE_VERSION: 20.x`
    - `buildCommand` (corepack enable, `pnpm install --frozen-lockfile`, `pnpm --filter @slopshield/api... build`, `prisma generate`), `preDeployCommand` (`prisma migrate deploy`), `startCommand: node apps/api/dist/main.js`
    - List env vars by name with `sync: false` for secrets plus `NODE_ENV=production`, `ANALYZER_TIMEOUT_MS`, `MAX_ANALYZE_FILES`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.2, 12.4_

  - [x] 8.2 Write property test for the live base-path join model
    - **Property 3: Live base-path join is exactly one `/api/...`**
    - **Validates: Requirements 6.2**
    - Generators: bases ending `/api` (no trailing slash) + paths with a single leading `/`; assert no double slashes outside the protocol and exactly one `/api/<path>` segment; min 100 iterations
    - Tag: `// Feature: backend-hosting-live-mode, Property 3`

  - [x] 8.3 Verify `.env.example` lists all required variable names without values
    - Ensure `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `LARK_*`, `CORS_ORIGIN`, `NODE_ENV`, `NEXT_PUBLIC_API_MODE`, `NEXT_PUBLIC_API_URL`, `ANALYZER_TIMEOUT_MS`, `MAX_ANALYZE_FILES` are present as names/placeholders only
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 9. Author the deployment document
  - [x] 9.1 Create the deployment doc covering Render, Neon, Upstash, and the Vercel live-mode flip
    - Render build/start/runtime + monorepo root handling and env var list; Neon `sslmode=require` + `prisma migrate deploy` timing; Upstash `rediss://` TLS
    - Vercel live-mode flip (`NEXT_PUBLIC_API_MODE=live`, `NEXT_PUBLIC_API_URL=…/api`, redeploy); JWT/seeded demo accounts; full-scan guardrails note; cold-start behavior; secrets handling; Stage 2 upgrade path marked out of scope
    - _Requirements: 3.1, 3.6, 3.7, 4.1, 4.2, 6.1, 7.5, 8.7, 9.3, 10.2, 10.3, 11.1, 11.2, 11.3, 11.4_

- [x] 10. Integration tests and wiring verification
  - [x] 10.1 Write integration test for the health endpoint
    - `GET /api/health` → 200, healthy JSON, no Authorization header required
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 10.2 Write integration tests for CORS and authentication
    - `OPTIONS` preflight with `Origin: <CORS_ORIGIN>` echoes the origin with credentials; protected route without bearer → 401, with valid bearer → processed; `POST /api/auth/login` with seeded creds → `accessToken`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 10.3 Write migration/connection integration test
    - `prisma migrate deploy` against a throwaway Postgres applies all migrations; boot connects with a valid `DATABASE_URL`
    - _Requirements: 4.3, 4.4_

- [x] 11. Final checkpoint - Ensure all tests pass and CI is green
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP, but they validate the six correctness properties and key behaviors.
- Each task references specific granular requirements for traceability.
- Property tests use `fast-check` with a minimum of 100 iterations and the per-property tag convention from the design Testing Strategy.
- The frontend base-path alignment (Requirement 6) needs no code change per the design decision; Property 3 verifies the join model and the operator-set `NEXT_PUBLIC_API_URL`.
- Provider account creation and live provisioning are operator-performed (out of scope) and excluded from coding tasks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.5", "2.1", "6.1"] },
    {
      "id": 1,
      "tasks": [
        "1.2",
        "1.3",
        "1.4",
        "1.6",
        "2.2",
        "3.1",
        "3.3",
        "3.4",
        "5.1",
        "5.3",
        "6.2",
        "8.1",
        "8.3"
      ]
    },
    { "id": 2, "tasks": ["3.2", "3.5", "5.2", "5.4", "8.2", "9.1"] },
    { "id": 3, "tasks": ["10.1", "10.2", "10.3"] }
  ]
}
```
