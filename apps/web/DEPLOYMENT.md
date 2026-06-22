# Deploying `@slopshield/web` to Vercel

This document captures the Vercel project settings required to deploy the
SlopShield AI frontend (`apps/web`) from this pnpm monorepo. In this milestone
the app deploys in **mock mode** by default — it renders every page from
clearly labeled demo data and performs no network egress to a backend.

> Backend services (NestJS API, PostgreSQL/Prisma, Redis/BullMQ, scanners,
> Gemini, Lark) are **not** deployed in this milestone. Live mode is wired but
> intentionally left unconfigured. See the spec design doc for the full
> "Out of Scope / Pending" list.

## Vercel Project Settings

| Setting              | Value                                     | Notes                                                                                                                                                                      |
| -------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Root Directory**   | `apps/web`                                | Scopes the project to the web app so no `apps/api` build is triggered.                                                                                                     |
| **Framework Preset** | Next.js                                   | Auto-detected.                                                                                                                                                             |
| **Install Command**  | `pnpm install` (run at the **repo root**) | Vercel detects the pnpm workspace via `pnpm-lock.yaml`. Do **not** scope the install to `apps/web`, or the `@slopshield/shared` workspace dependency will fail to resolve. |
| **Build Command**    | default (`next build`)                    | Turborepo is optional; the single-app build works directly.                                                                                                                |
| **Output**           | default (`.next`)                         | Standard Next.js output.                                                                                                                                                   |
| **Node.js Version**  | 20.x                                      | Matches Next 15 / React 19 support.                                                                                                                                        |

## Environment Variables (Production + Preview)

| Key                    | Value           | Notes                                                                                   |
| ---------------------- | --------------- | --------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_MODE` | `mock`          | The safe default for this milestone. The app renders demo data and never calls `fetch`. |
| `NEXT_PUBLIC_APP_NAME` | `SlopShield AI` | Display name for headers / titles.                                                      |
| `NEXT_PUBLIC_API_URL`  | _(unset)_       | Only set this when flipping to live mode in a later milestone.                          |

Because the config module defaults `NEXT_PUBLIC_API_MODE` to `mock` and never
throws at import time, the build succeeds even if all `NEXT_PUBLIC_*` variables
are unset.

## Monorepo Considerations

- **Shared package transpilation**: `@slopshield/shared` is a `workspace:*`
  dependency and is declared in `apps/web/next.config.ts` via
  `transpilePackages: ["@slopshield/shared"]`, so Next transpiles its TypeScript
  source at build time. No separate prebuild of the shared package is required.
- **No backend imports**: The web app must **not** import any server-only
  backend code (`apps/api/*`), Prisma (`@prisma/client`), Redis (`ioredis`), or
  BullMQ (`bullmq`). The only workspace import in `apps/web/src` is
  `@slopshield/shared`, whose types and Zod schemas are isomorphic (plain TS +
  Zod) and safe for the browser/build.
- **Scoped build**: Setting the Root Directory to `apps/web` ensures the Vercel
  project never triggers an `apps/api` build.

## Flipping to Live Mode (later milestone)

Once the backend is deployed, switch the deployment to live mode by setting:

| Key                    | Value                                                      |
| ---------------------- | ---------------------------------------------------------- |
| `NEXT_PUBLIC_API_MODE` | `live`                                                     |
| `NEXT_PUBLIC_API_URL`  | the deployed API base URL (e.g. `https://api.example.com`) |

If `NEXT_PUBLIC_API_MODE=live` is set without `NEXT_PUBLIC_API_URL`, the API
client throws a descriptive error on the first request (the build still
succeeds, since the guard runs at request time, not import time).
