# Deploying `@slopshield/api` to Render

This document describes how to deploy the SlopShield AI backend (`apps/api`) —
the NestJS REST API plus the in-process BullMQ scan worker — to Render, along
with the required environment variables, a runbook, and rollback notes.

The deployment is declared as code in [`render.yaml`](../../render.yaml) at the
repo root. The build runs from the monorepo root so the pnpm workspace
dependencies (`@slopshield/shared`, `@slopshield/scanner-plugins`) resolve.

For the frontend (Web_App) deployment, see [`apps/web/DEPLOYMENT.md`](../web/DEPLOYMENT.md).

## Architecture on Render

- **Service type:** a single Render Web Service running the NestJS API and the
  BullMQ `scan-pipeline` worker in the same process (free plan; no separate
  always-on worker).
- **Global prefix:** all routes are mounted under `/api`. The service binds
  `0.0.0.0` on the port injected via `PORT` (falling back to `API_PORT`, then
  `3001`).
- **Datastores:** Neon Postgres (via Prisma) and Upstash Redis (via BullMQ).
- **Health check:** Render polls `GET /api/health`.

## Environment Variables

### Hard-required in production

Startup **fails fast** (the process exits non-zero) if any of these are missing
or blank when `NODE_ENV=production`, so misconfiguration surfaces immediately
rather than at first request.

| Key            | Example                                              | Notes                                                                 |
| -------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require`     | Neon Postgres connection string.                                      |
| `REDIS_URL`    | `rediss://default:pass@host:6379`                    | Upstash Redis connection string for BullMQ.                           |
| `JWT_SECRET`   | a random 64-char string                              | Signs **access** tokens.                                              |
| `REFRESH_SECRET` | a *different* random 64-char string                | Signs **refresh** tokens. Must be present and **distinct** from `JWT_SECRET` in production — startup fails otherwise (Req 11.3). No insecure literal fallback exists in prod. |
| `CORS_ORIGIN`  | `https://slopshield.vercel.app`                      | Allowed Web_App origin(s). Must match the deployed frontend origin or browser requests are blocked. |

> **Note:** `REFRESH_SECRET` is new in the production-grade-system spec. Earlier
> deployments that relied on a shared/fallback refresh secret must set a
> distinct value before deploying, or boot will fail.

### Token lifetimes (optional, have defaults)

| Key                  | Default | Notes                                |
| -------------------- | ------- | ------------------------------------ |
| `JWT_EXPIRATION`     | `15m`   | Access-token TTL.                    |
| `REFRESH_EXPIRATION` | `7d`    | Refresh-token TTL.                   |

### Optional integrations (never block startup)

When absent or blank these are reported as `skipped` by the readiness endpoint
and the startup integration summary; the service boots and runs normally
(Req 11.4–11.7).

| Key                               | Integration | Notes                                                                       |
| --------------------------------- | ----------- | --------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                  | Gemini AI   | Enables AI review. Without it, AI review is skipped gracefully.             |
| `GEMINI_MODEL`                    | Gemini AI   | Model id (e.g. `gemini-2.5-pro`).                                           |
| `GITHUB_TOKEN`                    | GitHub      | Higher rate limits / private-repo access. Anonymous public access otherwise.|
| `LARK_WEBHOOK_URL`                | Lark        | Webhook the scan notification card is delivered to. Unset → delivery skipped and recorded as `skipped`. |
| `LARK_APP_ID` / `LARK_APP_SECRET` | Lark        | Lark app credentials.                                                       |
| `LARK_WEBHOOK_VERIFICATION_TOKEN` | Lark        | Inbound webhook verification token.                                         |
| `LARK_DEFAULT_CHAT_ID`            | Lark        | Default chat the card targets.                                              |
| `PUBLIC_WEB_URL`                  | Lark/report | Base URL used to build the report link in Lark cards. Falls back to `CORS_ORIGIN`. Set this to the deployed Web_App URL so cards never link to `localhost`. |

### Scan / analyzer tuning (optional, have defaults)

| Key                  | Default     | Notes                                                                  |
| -------------------- | ----------- | ---------------------------------------------------------------------- |
| `ANALYZER_TIMEOUT_MS`| `45000`     | Per-analyzer timeout enforced by the orchestrator.                     |
| `MAX_ANALYZE_FILES`  | `50`        | Max files sent to heavy analyzers (TypeScript, Semgrep, Gemini).       |
| `MAX_REPO_BYTES`     | `104857600` | Max repo tarball size streamed during ingestion (100 MB).              |
| `MAX_FILE_COUNT`     | `5000`      | Max files extracted into the scan directory.                           |
| `FETCH_TIMEOUT_MS`   | `60000`     | Max time for the repository fetch.                                     |
| `MAX_UPLOAD_SIZE_MB` | `50`        | Max accepted upload size.                                              |
| `NODE_ENV`           | —           | Set to `production` on Render.                                         |

All secret-bearing variables are declared with `sync: false` in `render.yaml`
and supplied through the Render dashboard so no credential values are committed.

## Deployment Steps

The build and migration steps are defined in `render.yaml`. On each deploy
Render runs:

1. `npm install -g pnpm@9.15.0` — pnpm is installed via npm (Node 20.18.0's
   bundled corepack has stale signing keys that fail to verify pnpm on Render).
2. `pnpm install --frozen-lockfile --prod=false` — `--prod=false` forces dev
   dependencies (prisma, nest CLI, typescript) to install even under
   `NODE_ENV=production` so the build can run.
3. `pnpm --filter @slopshield/api... build` — builds `@slopshield/shared` and
   `@slopshield/scanner-plugins` first (Turbo `^build`), then the API.
4. `pnpm --filter @slopshield/api exec prisma generate` — generates the Prisma
   client.
5. `pnpm --filter @slopshield/api exec prisma migrate deploy` — applies pending
   migrations. Run in the build step because Render Free has no
   `preDeployCommand`; it is a no-op when the schema is already in sync.

Start command: `node apps/api/dist/main.js`.

To deploy:

1. Ensure all required env vars (and a distinct `REFRESH_SECRET`) are set in the
   Render dashboard.
2. Push to the branch connected to the Render service (or trigger a manual
   deploy). Render runs the build/migration steps above.
3. After the deploy goes live, verify (see Runbook).

## Runbook (post-deploy verification)

1. **Health:** `GET /api/health` returns HTTP 200 with `{ status: "ok", ... }`.
   An unhealthy service returns a non-200 status.
2. **Readiness:** `GET /api/health/ready` returns the per-integration report,
   e.g. `{ "gemini": "configured", "githubToken": "skipped", "lark": "skipped" }`.
   Confirm each integration shows the expected status.
3. **Startup summary:** check the Render logs for the one-time integration
   summary line (`🔌 Integrations: gemini=..., githubToken=..., lark=...`) and
   confirm there are no "Missing required environment variable" or
   "REFRESH_SECRET" errors.
4. **Auth:** register/login returns an access token, a refresh token, and the
   user profile; the refresh endpoint issues a new access token and rejects
   invalid/revoked tokens with 401.
5. **End-to-end scan:** submit a public GitHub repository scan (e.g.
   `octocat/Hello-World`) and confirm it ingests, runs analyzers, scores, and
   persists findings. Lark delivery (if configured) records `pending` then
   `success`/`failed`; scan completion is never blocked by Lark.
6. **CORS:** confirm the deployed Web_App origin is in `CORS_ORIGIN` so live-mode
   browser requests succeed.

## Rollback

- **Redeploy a previous version:** in the Render dashboard, open the service's
  **Events/Deploys**, select the last known-good deploy, and **Redeploy** it.
- **Database migrations:** `prisma migrate deploy` only applies *forward*
  migrations and is idempotent. Rolling back application code does **not**
  automatically revert a schema migration. If a bad migration shipped, restore
  from a Neon point-in-time/backup or apply a corrective forward migration —
  do **not** hand-edit the `_prisma_migrations` table. Treat schema rollbacks as
  high-risk and verify against a backup first.
- **Env var regression:** if a deploy failed only due to a missing/incorrect env
  var (e.g. `REFRESH_SECRET` absent or equal to `JWT_SECRET`, missing
  `DATABASE_URL`/`REDIS_URL`/`CORS_ORIGIN`), correct it in the dashboard and
  redeploy. Boot-time validation will report exactly which variable is at fault
  in the logs.
- **Coordinated rollback:** because the Web_App speaks the shared Zod contract,
  roll back the API and Web_App to a compatible pair when a contract changed.

## Known Limitations

- **Free-tier cold starts:** the Render free plan spins the service down when
  idle; the first request after idle incurs a cold-start delay.
- **In-process worker:** the BullMQ scan worker runs inside the API process
  (no separate always-on worker). Long scans share resources with request
  handling; this is acceptable for the current scale but is a known constraint.
- **Migrations in the build step:** migrations run during build (Render Free has
  no `preDeployCommand`). A failing migration fails the build, so the previous
  version stays live — but verify migration safety before deploying.
- **Single region:** the service is deployed to a single region (`oregon`); no
  multi-region failover.
- **Out of scope** (tracked as future work): non-`github.com` Git hosts, GitHub
  App / PR status checks, autoscaling background workers, SSO/SAML, and
  multi-tenant org management.
