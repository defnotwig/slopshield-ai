# Deploying `@slopshield/web` to Vercel

This document captures the Vercel project settings and environment variables
required to deploy the SlopShield AI frontend (`apps/web`) from this pnpm
monorepo.

The Web_App runs in one of two modes, selected by `NEXT_PUBLIC_API_MODE`:

- **`live`** — the app talks only to the real NestJS API. No mock data is ever
  rendered. This is the production mode.
- **`mock`** — the app renders clearly labeled local demo data and performs no
  network egress. Useful for local demos and previews. Mock mode is **hard
  blocked in production** unless `ALLOW_MOCK_IN_PRODUCTION` is explicitly set
  (see Requirement 2).

For backend (API) deployment, see [`apps/api/DEPLOYMENT.md`](../api/DEPLOYMENT.md).

## Vercel Project Settings

| Setting              | Value                                     | Notes                                                                                                                                                                      |
| -------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Root Directory**   | `apps/web`                                | Scopes the project to the web app so no `apps/api` build is triggered.                                                                                                     |
| **Framework Preset** | Next.js                                   | Auto-detected.                                                                                                                                                             |
| **Install Command**  | `pnpm install` (run at the **repo root**) | Vercel detects the pnpm workspace via `pnpm-lock.yaml`. Do **not** scope the install to `apps/web`, or the `@slopshield/shared` workspace dependency will fail to resolve. |
| **Build Command**    | default (`next build`)                    | Turborepo is optional; the single-app build works directly.                                                                                                                |
| **Output**           | default (`.next`)                         | Standard Next.js output.                                                                                                                                                   |
| **Node.js Version**  | 20.x                                      | Matches Next 15 / React 19 support.                                                                                                                                        |

## Environment Variables

All Web_App runtime configuration is exposed through `NEXT_PUBLIC_*` variables,
which are inlined at **build time**. Changing any of them requires a redeploy.

| Key                         | Required        | Example                          | Notes                                                                                                                                  |
| --------------------------- | --------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_MODE`      | yes             | `live`                           | `live` uses the real API; `mock` serves local demo data. Defaults to `mock` when unset.                                                |
| `NEXT_PUBLIC_API_URL`       | in `live` mode  | `https://slopshield-api.onrender.com/api` | Base URL of the deployed API **including** the `/api` global prefix. Required when `NEXT_PUBLIC_API_MODE=live`.                |
| `NEXT_PUBLIC_APP_NAME`      | no              | `SlopShield AI`                  | Display name for headers / titles.                                                                                                     |
| `ALLOW_MOCK_IN_PRODUCTION`  | no              | `true`                           | Explicit opt-in required to run `mock` mode in a production environment. When set, the app renders a visible "mock data" indicator.    |

### Mode behavior summary

- `NEXT_PUBLIC_API_MODE=live` → `config.isMock` is forced to `false` regardless
  of any other flag. If `NEXT_PUBLIC_API_URL` is unset, the API client throws a
  descriptive error on the first request (the build still succeeds, since the
  guard runs at request time).
- `NEXT_PUBLIC_API_MODE=mock` (or unset) in a non-production environment →
  serves demo data.
- `NEXT_PUBLIC_API_MODE=mock` in production → refused unless
  `ALLOW_MOCK_IN_PRODUCTION` is set to an affirmative value. When permitted, a
  visible mock indicator is displayed so demo data is never mistaken for real
  results.

## Deployment Steps

1. Push the branch to the Git remote connected to the Vercel project.
2. In the Vercel project, set **Root Directory** to `apps/web` and confirm the
   settings in the table above.
3. Add the environment variables for the target environment (Production /
   Preview). For a real production deploy, set `NEXT_PUBLIC_API_MODE=live` and
   `NEXT_PUBLIC_API_URL` to the deployed API base URL (ending in `/api`).
4. Trigger a deploy (push to the tracked branch or "Redeploy" in the dashboard).
5. After the deploy completes, verify (see Runbook below).

## Runbook (post-deploy verification)

1. **Frontend loads:** open the deployment URL; the dashboard renders without a
   blank screen or console errors.
2. **Mode is correct:** in production there must be **no** "mock data"
   indicator. If one appears, `NEXT_PUBLIC_API_MODE` is not `live` (or mock was
   explicitly opted in) — fix the env var and redeploy.
3. **API reachability:** confirm the API base URL responds:
   `GET {NEXT_PUBLIC_API_URL}/health` returns HTTP 200, and
   `GET {NEXT_PUBLIC_API_URL}/health/ready` returns the per-integration
   readiness report.
4. **Auth round-trip:** log in; confirm the session persists and that an
   expired access token is silently refreshed (the app should not bounce you to
   `/auth/login` mid-session).
5. **End-to-end scan:** submit a public GitHub repository scan and confirm
   progress events stream and a real report renders.

## Rollback

- **Instant rollback:** in the Vercel dashboard, open **Deployments**, find the
  last known-good deployment, and choose **Promote to Production** (or
  **Rollback**). This is the fastest recovery path and does not require a
  rebuild.
- **Env var regression:** if a deploy broke only because of an environment
  variable change (e.g. wrong `NEXT_PUBLIC_API_URL` or an accidental
  `mock`/`ALLOW_MOCK_IN_PRODUCTION` setting), correct the variable and redeploy;
  there is no separate data migration to undo on the frontend.
- **Coordinated rollback:** because `NEXT_PUBLIC_*` values are build-time
  constants, a frontend pointing at an incompatible API contract is fixed by
  rolling back the frontend deployment, the API, or both to a compatible pair.

## Monorepo Considerations

- **Shared package transpilation:** `@slopshield/shared` is a `workspace:*`
  dependency declared in `apps/web/next.config.ts` via
  `transpilePackages: ["@slopshield/shared"]`, so Next transpiles its TypeScript
  source at build time. No separate prebuild of the shared package is required.
- **No backend imports:** the web app must **not** import any server-only
  backend code (`apps/api/*`), Prisma (`@prisma/client`), Redis (`ioredis`), or
  BullMQ (`bullmq`). The only workspace import in `apps/web/src` is
  `@slopshield/shared`, whose types and Zod schemas are isomorphic (plain TS +
  Zod) and safe for the browser/build.
- **Scoped build:** setting the Root Directory to `apps/web` ensures the Vercel
  project never triggers an `apps/api` build.
- **CORS:** the API must include the deployed Web_App origin in its
  `CORS_ORIGIN` allowlist, otherwise live-mode requests will be blocked by the
  browser. See the API deployment doc.

## Known Limitations

- `NEXT_PUBLIC_*` variables are inlined at build time, so changing the API URL
  or mode requires a **redeploy** — runtime env changes have no effect.
- In `live` mode the Web_App is only as available as the API it points to; if
  the API (Render free tier) is cold-starting, the first requests may be slow.
- Mock mode is for demos only. It is intentionally inert for mutations and emits
  console warnings for any unmodeled operation; it must never be enabled in
  production without the explicit `ALLOW_MOCK_IN_PRODUCTION` opt-in.
