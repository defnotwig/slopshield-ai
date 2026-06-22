# Deploying the SlopShield AI Backend (Render + Neon + Upstash) and Flipping the Frontend to Live Mode

This document is the operator runbook for hosting the SlopShield AI backend
(`apps/api`, the NestJS API that also runs the BullMQ scan worker in-process)
on a **Render Free Web Service**, backed by **Neon Free PostgreSQL** and
**Upstash Free Redis**, and then flipping the already-deployed Vercel frontend
(`apps/web`) from **mock mode** to **live mode**.

It is the companion to [`apps/web/DEPLOYMENT.md`](../apps/web/DEPLOYMENT.md),
which covers the Vercel frontend project itself.

> **Stage 1 / free-first topology.** This milestone targets free tiers and
> accepts the Render Free cold-start tradeoff (see
> [Cold-start behavior](#9-cold-start-behavior)). Stage 2 production hosting is
> documented as a [future upgrade path](#12-stage-2-production-upgrade-path-out-of-scope)
> and is out of scope here.

> **Secrets.** No credential values appear in this document or the repository.
> Every variable is listed **by name only**; values are supplied as Render or
> Vercel environment variables. See [Secrets handling](#10-secrets-handling).

---

## Topology at a glance

| Component         | Host                      | Connection                                            |
| ----------------- | ------------------------- | ----------------------------------------------------- |
| Web_App (Next.js) | Vercel (already deployed) | HTTPS + bearer JWT to the API, gated by `CORS_ORIGIN` |
| API (NestJS)      | Render Free Web Service   | Serves everything under the `/api` global prefix      |
| Scan worker       | In-process in the API     | BullMQ over TLS to Upstash                            |
| PostgreSQL        | Neon Free                 | Prisma over `DATABASE_URL` with `sslmode=require`     |
| Redis             | Upstash Free              | BullMQ over `rediss://` (TLS)                         |
| Gemini AI         | Google (existing key)     | AI review when `GEMINI_API_KEY` is present            |
| Lark              | Lark (existing keys)      | Bot / scan cards via `LARK_*`                         |

The deployment is reproducible from the committed
[`render.yaml`](../render.yaml) blueprint at the repository root.

---

## 1. Provision the managed data services

Perform these once, before the first Render deploy.

1. **Neon (PostgreSQL):** create a Free project and database. Copy two
   connection strings:
   - the **pooled** string (host contains `-pooler`) for the app, and
   - the **direct** (non-pooled) string for migrations.

   Append `?sslmode=require` to each. See [Neon](#4-neon-postgresql) for the
   pooled-vs-direct nuance.

2. **Upstash (Redis):** create a Free database and copy the **`rediss://`** URL
   (TLS). See [Upstash](#5-upstash-redis).
3. **Render:** create an account; you will create the Web Service in the next
   step.

---

## 2. Render service configuration

The service is defined by the committed [`render.yaml`](../render.yaml)
blueprint. Create the service from the blueprint (Render → New → Blueprint, pick
this repo), or replicate the settings in the dashboard.

### Build / start / runtime

| Setting            | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Type               | `web`                                                                  |
| Runtime            | `node`                                                                 |
| Plan               | `free`                                                                 |
| Node version       | **20.x** (`NODE_VERSION=20.18.0`, or an `.nvmrc`)                      |
| **Root Directory** | **repo root (`rootDir: .`)** — required so the pnpm workspace resolves |
| Health Check Path  | **`/api/health`**                                                      |
| Build Command      | see below                                                              |
| Pre-Deploy Command | `pnpm --filter @slopshield/api exec prisma migrate deploy`             |
| Start Command      | `node apps/api/dist/main.js`                                           |

**Build command** (installs at the monorepo root, builds workspace deps first,
then generates the Prisma client):

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @slopshield/api... build      # builds @slopshield/shared + scanner-plugins first (Turbo ^build)
pnpm --filter @slopshield/api exec prisma generate
```

### Monorepo root handling (why `rootDir: .`)

SlopShield AI is a pnpm workspace. The API depends on the workspace packages
`@slopshield/shared` and `@slopshield/scanner-plugins`. If the build is scoped
to `apps/api`, those `workspace:*` dependencies do not resolve. Building from
the **repository root** lets pnpm link the workspace, and the
`pnpm --filter @slopshield/api...` selector (note the trailing `...`) builds the
API **and its workspace dependencies first**, matching Turbo's `^build` order.
This guarantees `apps/api/dist/main.js` exists by the time the start command
runs. The compiled entry point is `node apps/api/dist/main.js` (equivalently
`node dist/main` from inside `apps/api`).

### Render environment variables (names only)

Set these on the Render service. Secrets are declared `sync: false` in
`render.yaml` and entered in the dashboard.

| Variable                          | Required (prod) | Notes                                                                   |
| --------------------------------- | --------------- | ----------------------------------------------------------------------- |
| `PORT`                            | injected        | Render provides it; the API binds it (takes precedence over `API_PORT`) |
| `DATABASE_URL`                    | yes             | Neon **pooled** URL + `?sslmode=require`                                |
| `DIRECT_DATABASE_URL`             | optional        | Neon **direct** (non-pooled) URL for `migrate deploy`                   |
| `REDIS_URL`                       | yes             | Upstash `rediss://…` → TLS enabled                                      |
| `JWT_SECRET`                      | yes             | 64-char random string                                                   |
| `GEMINI_API_KEY`                  | no (degrades)   | Enables Gemini AI review when present                                   |
| `LARK_APP_ID`                     | no              | Lark bot / cards                                                        |
| `LARK_APP_SECRET`                 | no              | Lark bot / cards                                                        |
| `LARK_WEBHOOK_VERIFICATION_TOKEN` | no              | Lark webhook                                                            |
| `LARK_DEFAULT_CHAT_ID`            | no              | Lark default chat                                                       |
| `CORS_ORIGIN`                     | yes             | Must be the **Vercel origin** (no trailing slash)                       |
| `NODE_ENV`                        | yes             | Must be `production`                                                    |
| `ANALYZER_TIMEOUT_MS`             | no              | Default `45000`                                                         |
| `MAX_ANALYZE_FILES`               | no              | Default `50`                                                            |
| `NODE_OPTIONS`                    | no              | Optional `--max-old-space-size=460` on the 512 MB free tier             |

`CORS_ORIGIN` **must** equal the deployed Vercel origin and `NODE_ENV` **must**
be `production`. The API validates required variables at boot and aborts with a
descriptive error naming any that are missing.

---

## 3. Port binding

Render injects the listen port via `PORT`. The API resolves the port with this
precedence: `PORT` (when a valid positive integer) → `API_PORT` → `3001`. It
binds `0.0.0.0` and logs the chosen port on startup. No manual port
configuration is required on Render.

---

## 4. Neon (PostgreSQL)

- **Connection string:** `DATABASE_URL` points at the Neon database and **must
  include `?sslmode=require`**. Neon requires TLS.
- **Migrations on deploy:** migrations apply via the Render **pre-deploy
  command** `prisma migrate deploy`, which runs **once per deploy** (before the
  new instance starts serving). If `prisma migrate deploy` exits non-zero, the
  **deploy fails** and the migration error appears in the deploy logs — the old
  instance keeps serving. The existing migrations under
  `apps/api/prisma/migrations` are the source of truth and apply unchanged.
- **Pooled vs. direct connection nuance:** use the Neon **pooled** connection
  string (host contains `-pooler`) for the running app — it suits many
  short-lived connections. Run **migrations against the direct (non-pooled)**
  connection, because PgBouncer transaction pooling can break the advisory locks
  and DDL that migrations rely on. Capture the direct URL either via `directUrl`
  in `schema.prisma` or by pointing the pre-deploy command at a
  `DIRECT_DATABASE_URL`. The minimum viable path — a single pooled URL with
  `sslmode=require` — works for the small migration set here; split the URLs if a
  migration hangs.

After the first deploy, the API connects to Neon with a valid `DATABASE_URL`. If
the connection fails, the API logs a descriptive database connection error (host
redacted).

---

## 5. Upstash (Redis)

The BullMQ scan queue connects to Upstash over TLS. Set `REDIS_URL` to the
Upstash **`rediss://`** URL. The `rediss:` scheme enables TLS on the connection;
a plain `redis:` URL connects without TLS (used locally). Host, port (default
`6379` when omitted), and password are derived from the URL. If the Redis
connection fails, the API logs a descriptive Redis connection error.

---

## 6. Vercel live-mode flip

Once the API is live and healthy, switch the Vercel frontend to live mode.

1. In the Vercel project (Production + Preview), set:

   | Key                    | Value                            |
   | ---------------------- | -------------------------------- |
   | `NEXT_PUBLIC_API_MODE` | `live`                           |
   | `NEXT_PUBLIC_API_URL`  | `https://<app>.onrender.com/api` |

   **Include the `/api` suffix and use no trailing slash.** The API client
   concatenates `${NEXT_PUBLIC_API_URL}${path}`, so
   `…/api` + `/scans` resolves to `…/api/scans` (exactly one `/api/...`
   segment). A trailing slash would produce a double slash.

2. **Redeploy** the Vercel project so the new build picks up the public
   variables (they are inlined at build time).
3. After redeploy, the **mock-mode banner disappears** and pages load real data
   from the API instead of seeded demo data.

If `NEXT_PUBLIC_API_MODE=live` is set while `NEXT_PUBLIC_API_URL` is empty, the
API client throws a descriptive configuration error on the first request and
never calls `fetch`.

---

## 7. Authentication and seeded demo accounts

The API issues a JWT from its login endpoint; the Web_App stores it and sends it
as a bearer token.

- **How the Web_App obtains a JWT:** the login page posts credentials to
  `POST /api/auth/login`. On success the API returns an `accessToken`, which the
  Web_App stores in `localStorage("slopshield_token")`. The API client reads the
  same key and sends it as `Authorization: Bearer <token>` on every request.
  Protected endpoints return HTTP `401` when a valid JWT is absent.
- **Seeded demo accounts:** the seed creates demo users `alice`, `bob`,
  `charlie`, and `admin`, each at the `@example.com` domain (for example
  `alice@example.com`), all with the password **`password123`**. Use any of
  these to log in and obtain a JWT. Run the seed against Neon if the demo
  accounts are needed in the hosted database.
- **CORS:** with `CORS_ORIGIN` set to the Vercel origin, the API allows
  credentialed cross-origin requests (including the `OPTIONS` preflight) from
  that origin.

---

## 8. Full-scan guardrails on the free tier

The live deployment runs the **full analyzer suite** — secret scan, basic/slop
rules, ESLint, TypeScript diagnostics, Semgrep (where the binary is available),
and Gemini AI review (where `GEMINI_API_KEY` is set) — engineered to stay within
Render Free CPU and memory limits through these guardrails:

- **Concurrency `1`:** the in-process scan worker processes one scan at a time,
  bounding the memory footprint.
- **Per-analyzer timeouts:** each analyzer is time-boxed by `ANALYZER_TIMEOUT_MS`
  (default `45000`). A hung, failing, or unavailable analyzer is recorded as
  skipped/failed and the scan continues with partial findings rather than
  failing the whole scan.
- **File caps:** the repository safety caps `MAX_REPO_BYTES` and
  `MAX_FILE_COUNT` apply, and `MAX_ANALYZE_FILES` (default `50`) additionally
  bounds the number of files sent to the memory- and CPU-intensive analyzers
  (TypeScript, Semgrep, Gemini AI review).

Gemini AI review is included when `GEMINI_API_KEY` is configured; when it is
absent, the deterministic analyzers still produce and persist findings.
**Very large repositories may exceed the free tier** and require the Stage 2
paid always-on worker for reliable full scans.

---

## 9. Cold-start behavior

Render Free spins the service **down after roughly 15 minutes of inactivity**
and **cold-starts in roughly 1 minute** on the next request. The first request
after idle may therefore be slow. The frontend tolerates this: TanStack Query
retries the request (up to 3 attempts with exponential backoff) and keeps the UI
in a **loading state** rather than showing an error while the API wakes. This
tradeoff is acceptable for a demo but not for production — see Stage 2.

---

## 10. Secrets handling

- The repository contains **no provider credential values** for `DATABASE_URL`,
  `REDIS_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, or any `LARK_*` variable. `.env`
  is gitignored; `.env.example` carries names/placeholders only.
- Every required environment variable is listed **by name without its value**
  (see [Render env vars](#render-environment-variables-names-only) and the
  Vercel table in [the live-mode flip](#6-vercel-live-mode-flip)).
- **All provider credentials are configured as Render or Vercel environment
  variables** — backend secrets on Render (`sync: false` in `render.yaml`), the
  public `NEXT_PUBLIC_*` variables on Vercel.

---

## 11. Deployment checklist

1. **Provision** Neon, Upstash, and a Render account (Section 1).
2. **Create the Render service** from `render.yaml` (or the dashboard
   equivalent): Node 20.x, root dir = repo root, build/pre-deploy/start commands
   as above, health check `/api/health`.
3. **Set Render env vars:** all `sync: false` secrets plus `NODE_ENV=production`
   and `CORS_ORIGIN=<Vercel origin>`. `DATABASE_URL` includes `?sslmode=require`;
   `REDIS_URL` is the `rediss://` URL.
4. **Migrate:** `prisma migrate deploy` runs automatically via the pre-deploy
   command; a non-zero exit fails the deploy. Seed the demo users if needed.
5. **Verify:** `GET /api/health` returns `200`, and `POST /api/auth/login` with
   a seeded account issues a JWT.
6. **Flip to live mode** on Vercel: set `NEXT_PUBLIC_API_MODE=live` and
   `NEXT_PUBLIC_API_URL=https://<app>.onrender.com/api` (include `/api`, no
   trailing slash), then **redeploy**. The mock banner disappears.
7. **Expect a cold start** on the first request after idle; the frontend retries
   through it.

---

## 12. Stage 2 production upgrade path (out of scope)

The following are documented as a **future** upgrade path and are **out of
scope** for this milestone:

- **Always-on paid workers** (no cold starts; reliable full scans on large
  repositories).
- **Paid PostgreSQL and Redis** (Neon/Upstash paid tiers or equivalents) for
  higher connection limits, persistence guarantees, and throughput.
- **A separate extracted worker process/service** (moving the BullMQ scan worker
  out of the API process) so scans and API traffic scale independently.
- **Custom domains** for the API and the Web_App.

These are not configured here; Stage 1 runs the full analyzer suite in-process
on the free tier with the guardrails above.
