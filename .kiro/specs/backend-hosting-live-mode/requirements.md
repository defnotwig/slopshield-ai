# Requirements Document

## Introduction

This feature deploys the SlopShield AI backend (the NestJS API at `apps/api`, which also runs the BullMQ scan worker in-process) to real hosting and flips the already-deployed Vercel frontend (`apps/web`) from mock mode to live mode pointing at the hosted API, so the deployed system shows real data end-to-end.

The approved free-first topology is: the `Web_App` on Vercel (already deployed in mock mode), the `API` on a Render Free Web Service, PostgreSQL on Neon Free, and Redis on Upstash Free for the BullMQ queue. Gemini (existing `GEMINI_API_KEY`) provides AI review and Lark (existing `LARK_*` variables) provides bot/card delivery. Render Free spins the service down after roughly 15 minutes of inactivity and cold-starts in roughly 1 minute, which is acceptable for a demo but not for production.

The work is primarily code and configuration changes plus documented provisioning steps. It captures three concrete code gaps discovered in the real codebase that block hosting today: the `API` listens on `API_PORT` but Render injects `PORT`; the BullMQ connection parses `REDIS_URL` but does not enable TLS, which Upstash requires via the `rediss://` scheme; and the `Web_App` API client issues paths such as `/scans` while the `API` mounts all routes under the `/api` global prefix, so the live base URL and client paths must be aligned.

The live deployment runs the full analyzer suite (secret scan, basic/slop rules, ESLint, TypeScript diagnostics, Semgrep where its binary is available, and Gemini AI review where `GEMINI_API_KEY` is configured) engineered to stay within Render Free CPU and memory limits through guardrails such as single-concurrency processing, per-analyzer timeouts, and file caps. Stage 2 production hosting (always-on paid workers, paid PostgreSQL/Redis, and a separate extracted worker process, and custom domains) is explicitly out of scope and documented only as a future upgrade path; the heavy analyzers themselves are in scope for this milestone.

## Glossary

- **System**: The deployed SlopShield AI system as a whole, comprising the `Web_App`, the `API`, and the managed data services.
- **API**: The NestJS application at `apps/api` (`@slopshield/api`), bootstrapped in `apps/api/src/main.ts`, which mounts all routes under the global prefix `/api` and also hosts the in-process BullMQ scan worker.
- **Web_App**: The SlopShield AI Next.js frontend at `apps/web` (`@slopshield/web`), already deployed to Vercel.
- **API_Client**: The frontend module at `apps/web/src/lib/api-client.ts` exposing `apiClient.get/post/patch/delete` and `ApiError`, which in live mode fetches `${config.apiUrl}${path}` with a bearer token from `localStorage("slopshield_token")`.
- **Config_Module**: The frontend module at `apps/web/src/lib/config.ts` that resolves `NEXT_PUBLIC_API_MODE` and `NEXT_PUBLIC_API_URL` and exposes `assertLiveConfig`.
- **Scan_Worker**: The BullMQ processor `ScanProcessor` (`apps/api/src/scan/scan.processor.ts`) registered on the `scan-pipeline` queue, which runs in-process inside the `API`.
- **Health_Endpoint**: An unauthenticated HTTP endpoint exposed by the `API` for Render health monitoring.
- **Render_Service**: The Render Free Web Service instance hosting the `API`.
- **Neon_Database**: The Neon Free PostgreSQL database referenced by `DATABASE_URL`.
- **Upstash_Redis**: The Upstash Free Redis instance referenced by `REDIS_URL`, accessed over TLS via the `rediss://` scheme.
- **Vercel_Origin**: The public HTTPS origin of the deployed `Web_App` on Vercel.
- **API_Base_URL**: The public HTTPS base URL of the deployed `API`, including the `/api` global prefix, set as `NEXT_PUBLIC_API_URL`.
- **PORT**: The TCP port number provided by Render to the `API` process via the `PORT` environment variable.
- **JWT**: The JSON Web Token issued by the `API` authentication endpoints and stored by the `Web_App` in `localStorage("slopshield_token")`.
- **Full_Scan**: A scan execution configuration that runs the full analyzer suite (basic/slop rules, secret scan, ESLint, TypeScript diagnostics, Semgrep where its binary is available, and Gemini AI review where `GEMINI_API_KEY` is configured) within bounded resources (single-concurrency processing, per-analyzer timeouts, and file caps) sized to fit Render Free CPU and memory limits.
- **Deployment_Doc**: The deployment documentation file(s) describing the Render, Neon, Upstash, and Vercel setup, environment variables, migration step, and live-mode flip.
- **Operator**: The person who creates provider accounts and performs the hosted provisioning by following the `Deployment_Doc`.

## Requirements

### Requirement 1: API Health-Check Endpoint

**User Story:** As an operator, I want the API to expose an unauthenticated health-check endpoint, so that Render can monitor the service and I can confirm the deployment is up.

#### Acceptance Criteria

1. THE `API` SHALL expose an HTTP `GET` health-check route at `/api/health`.
2. WHEN a `GET` request is made to the `Health_Endpoint` AND the `API` process is running, THE `API` SHALL respond with HTTP status `200`.
3. WHEN a `GET` request is made to the `Health_Endpoint`, THE `API` SHALL return a JSON body containing a status field whose value indicates the service is healthy.
4. THE `Health_Endpoint` SHALL respond without requiring a `JWT` or any authentication credential.

### Requirement 2: Render Port Binding

**User Story:** As an operator, I want the API to listen on the port Render assigns, so that the Render Free Web Service routes traffic to the running process.

#### Acceptance Criteria

1. WHEN the `PORT` environment variable is set, THE `API` SHALL listen on the port specified by `PORT`.
2. IF the `PORT` environment variable is unset AND `API_PORT` is set, THEN THE `API` SHALL listen on the port specified by `API_PORT`.
3. IF both `PORT` and `API_PORT` are unset, THEN THE `API` SHALL listen on port `3001`.
4. WHEN the `API` begins listening, THE `API` SHALL log the port on which it is listening.

### Requirement 3: Render Service Build and Start Configuration

**User Story:** As an operator, I want documented Render build and start settings for the monorepo, so that the API builds and starts correctly on Render Free.

#### Acceptance Criteria

1. THE `Deployment_Doc` SHALL specify that the `Render_Service` installs dependencies with pnpm at the repository root so that workspace dependencies (`@slopshield/shared`, `@slopshield/scanner-plugins`) resolve.
2. THE `Deployment_Doc` SHALL specify a build command that produces the compiled `API` output under `apps/api/dist`.
3. THE `Deployment_Doc` SHALL specify a start command that runs the compiled `API` entry point (`node dist/main`) from the `apps/api` directory.
4. THE `Deployment_Doc` SHALL specify Node.js version `20.x` as the `Render_Service` runtime.
5. THE `Deployment_Doc` SHALL specify the monorepo root-directory handling required for the `Render_Service` to build `apps/api` within the workspace.
6. THE `Deployment_Doc` SHALL list the required `Render_Service` environment variables by name without values: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_WEBHOOK_VERIFICATION_TOKEN`, `LARK_DEFAULT_CHAT_ID`, `CORS_ORIGIN`, and `NODE_ENV`.
7. THE `Deployment_Doc` SHALL state that `CORS_ORIGIN` must be set to the `Vercel_Origin` and `NODE_ENV` must be set to `production` on the `Render_Service`.

### Requirement 4: Neon PostgreSQL Connection and Migrations

**User Story:** As an operator, I want the API to connect to Neon over a secure connection and apply existing migrations on release, so that the hosted database matches the Prisma schema.

#### Acceptance Criteria

1. THE `Deployment_Doc` SHALL specify that `DATABASE_URL` points to the `Neon_Database` and includes `sslmode=require`.
2. THE `Deployment_Doc` SHALL specify that database migrations are applied on release using `prisma migrate deploy`.
3. WHEN `prisma migrate deploy` runs against an empty `Neon_Database` using the existing migrations under `apps/api/prisma/migrations`, THE migrations SHALL apply successfully.
4. WHEN the `API` starts with a valid `DATABASE_URL`, THE `API` SHALL establish a connection to the `Neon_Database`.

### Requirement 5: Upstash Redis TLS Connection for BullMQ

**User Story:** As an operator, I want the BullMQ queue to connect to Upstash Redis over TLS, so that the scan queue works on the hosted free tier.

#### Acceptance Criteria

1. WHEN `REDIS_URL` uses the `rediss://` scheme, THE `API` SHALL enable TLS on the BullMQ Redis connection.
2. WHEN `REDIS_URL` uses the `redis://` scheme, THE `API` SHALL connect without TLS.
3. WHEN parsing `REDIS_URL`, THE `API` SHALL derive the host, port, and password from the URL.
4. WHEN `REDIS_URL` omits an explicit port, THE `API` SHALL default the Redis port to `6379`.
5. WHEN the `API` starts with a valid `rediss://` `REDIS_URL` pointing at `Upstash_Redis`, THE `API` SHALL establish a connection to `Upstash_Redis` for the `scan-pipeline` queue.

### Requirement 6: Frontend Live-Mode Flip

**User Story:** As an operator, I want to flip the deployed frontend to live mode against the hosted API, so that the deployed system shows real data instead of mock data.

#### Acceptance Criteria

1. THE `Deployment_Doc` SHALL specify that the `Web_App` is switched to live mode by setting `NEXT_PUBLIC_API_MODE` to `live` and `NEXT_PUBLIC_API_URL` to the `API_Base_URL` in the Vercel project environment, followed by a redeploy.
2. THE `API_Base_URL` configured as `NEXT_PUBLIC_API_URL` SHALL resolve, when concatenated with an `API_Client` request path such as `/scans`, to a URL served under the `API` `/api` global prefix.
3. WHEN the `Web_App` runs with `NEXT_PUBLIC_API_MODE` set to `live` and a non-empty `NEXT_PUBLIC_API_URL`, THE `Web_App` SHALL load data from the `API` rather than from mock data.
4. WHILE the `Web_App` is in live mode, THE `Web_App` SHALL NOT display the mock-mode banner.
5. IF `NEXT_PUBLIC_API_MODE` is `live` AND `NEXT_PUBLIC_API_URL` is empty, WHEN an `API_Client` request is made, THEN THE `API_Client` SHALL throw a descriptive configuration error and SHALL NOT call `fetch`.

### Requirement 7: CORS and Authentication for Live Requests

**User Story:** As an operator, I want the API to accept authenticated cross-origin requests from the Vercel frontend, so that the live frontend can call protected endpoints.

#### Acceptance Criteria

1. WHEN `CORS_ORIGIN` is set to the `Vercel_Origin`, THE `API` SHALL allow cross-origin requests from the `Vercel_Origin` with credentials enabled.
2. WHEN valid credentials are submitted to the `API` login endpoint (`POST /api/auth/login`), THE `API` SHALL return a `JWT` access token.
3. WHEN the `Web_App` sends a request to a protected endpoint with a valid `JWT` in the `Authorization` bearer header, THE `API` SHALL process the request.
4. IF a request to a protected endpoint omits a valid `JWT`, THEN THE `API` SHALL respond with HTTP status `401`.
5. THE `Deployment_Doc` SHALL describe how the `Web_App` obtains a `JWT`, including the seeded demo accounts (`alice`, `bob`, `charlie`, `admin` at `@example.com` with password `password123`).

### Requirement 8: Full Scan Within Free-Tier Resource Limits

**User Story:** As an operator, I want the live deployment to run the full analyzer suite while staying within Render Free CPU and memory limits, so that real scans produce complete results without the process being OOM-killed.

#### Acceptance Criteria

1. WHEN the `Scan_Worker` processes a scan job, THE `Scan_Worker` SHALL by default run the `Full_Scan` analyzer suite, comprising the secret-scan analyzer, the basic/slop rules analyzer, the ESLint analyzer, the TypeScript diagnostics analyzer, the Semgrep analyzer where the Semgrep binary is available, and Gemini AI review where `GEMINI_API_KEY` is configured.
2. THE `Scan_Worker` SHALL process scan jobs with a bounded concurrency of `1` concurrent scan so that the in-process worker memory footprint stays within Render Free limits.
3. WHEN the `Scan_Worker` runs an analyzer, THE `Scan_Worker` SHALL enforce a per-analyzer timeout, AND IF an analyzer exceeds its timeout or fails, THEN THE `Scan_Worker` SHALL record the analyzer as skipped or failed and continue running the remaining analyzers without failing the entire scan.
4. WHEN the `Scan_Worker` processes a scan, THE `Scan_Worker` SHALL enforce the repository safety caps `MAX_REPO_BYTES` and `MAX_FILE_COUNT`, AND SHALL additionally bound the number of files sent to the memory- and CPU-intensive analyzers (TypeScript diagnostics, Semgrep, and Gemini AI review) via a configurable file cap.
5. WHERE the Semgrep binary is not available on the host, THE `Scan_Worker` SHALL skip the Semgrep analyzer and continue the remaining analyzers.
6. WHERE `GEMINI_API_KEY` is configured, THE `Scan_Worker` SHALL include Gemini AI review in the scan; WHERE `GEMINI_API_KEY` is absent, THE `Scan_Worker` SHALL still produce the deterministic analyzer results.
7. THE `Deployment_Doc` SHALL document that the `Full_Scan` runs within Render Free limits through the guardrails (concurrency of `1`, per-analyzer timeouts, and file caps), AND SHALL document that very large repositories may require the Stage 2 paid always-on worker for reliable full scans.

### Requirement 9: Cold-Start Tolerance

**User Story:** As a viewer of the live demo, I want the frontend to handle the Render free-tier cold start gracefully, so that the app does not appear broken while the API wakes up.

#### Acceptance Criteria

1. WHILE the `Render_Service` is waking from idle, WHEN the `Web_App` issues an `API` request, THE `Web_App` SHALL display a loading state rather than an error state.
2. IF an `API` request fails or times out while the `Render_Service` is waking, THEN THE `Web_App` SHALL retry the request at least once before surfacing an error.
3. THE `Deployment_Doc` SHALL document the Render Free cold-start behavior (approximately 1 minute wake after approximately 15 minutes idle) and its impact on the first request.

### Requirement 10: Secrets Handling

**User Story:** As an operator, I want all provider credentials supplied as hosting environment variables, so that no secrets are committed to the repository.

#### Acceptance Criteria

1. THE repository SHALL NOT contain provider credential values for `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, or any `LARK_*` variable.
2. THE `Deployment_Doc` SHALL list every required environment variable by name without including its value.
3. THE `Deployment_Doc` SHALL specify that all provider credentials are configured as `Render_Service` or Vercel environment variables.

### Requirement 11: Deployment Documentation

**User Story:** As an operator, I want a complete deployment document, so that I can provision the hosted services and flip the frontend to live mode by following written steps.

#### Acceptance Criteria

1. THE `Deployment_Doc` SHALL describe the full setup for the `Render_Service`, `Neon_Database`, `Upstash_Redis`, and the Vercel live-mode flip.
2. THE `Deployment_Doc` SHALL include the migration step (`prisma migrate deploy`) and the point in the deployment at which it runs.
3. THE `Deployment_Doc` SHALL include the complete list of required environment variables by name.
4. THE `Deployment_Doc` SHALL include the Stage 2 production upgrade path (always-on paid workers, paid PostgreSQL/Redis, a separate extracted worker process, and custom domains) marked as future and out of scope.

### Requirement 12: Boot and Connection Error Handling

**User Story:** As an operator, I want startup and connection failures surfaced clearly in logs and health, so that I can diagnose a failed deployment quickly.

#### Acceptance Criteria

1. IF a required environment variable is missing at boot, THEN THE `API` SHALL log a descriptive error identifying the missing variable by name.
2. IF the connection to the `Neon_Database` fails, THEN THE `API` SHALL log a descriptive database connection error.
3. IF the connection to `Upstash_Redis` fails, THEN THE `API` SHALL log a descriptive Redis connection error.
4. IF `prisma migrate deploy` fails during release, THEN THE release process SHALL report a non-zero exit status and log the migration failure.

## Out of Scope

- Stage 2 production hosting on Railway or Render paid tiers, including always-on paid workers and paid PostgreSQL/Redis provisioning.
- Extracting the `Scan_Worker` into a separate worker process or service (the full analyzer suite runs in-process on the free tier with guardrails for this milestone).
- Custom domains for the `API` or `Web_App`.
- The actual creation of provider accounts and execution of hosted provisioning, which the `Operator` performs by following the `Deployment_Doc`.

## Dependencies and Assumptions

- The `Operator` creates the Render, Neon, and Upstash accounts; this spec covers the code and configuration changes plus the documented provisioning steps, while the hosted provisioning is performed by the `Operator`.
- The Vercel deployment of the `Web_App` already exists in mock mode (from the `vercel-fast-deploy` spec) with the live-mode plumbing in `config.ts` and `api-client.ts` already present.
- Valid `GEMINI_API_KEY` and `LARK_*` credentials are available to the `Operator`.
- The existing Prisma migrations under `apps/api/prisma/migrations` are the source of truth for the `Neon_Database` schema.
- The repository CI workflow (`.github/workflows/ci.yml`) must continue to pass after these changes.
