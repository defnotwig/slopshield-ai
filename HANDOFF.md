# SlopShield AI — Senior Engineer Handoff & Scanner Improvement Plan

## Executive Summary

SlopShield AI is a production-grade code quality platform deployed as a Turborepo monorepo. The backend (NestJS) runs on Render at `https://slopshield-ai.onrender.com`, the frontend (Next.js 15) on Vercel at `https://slopshield-ai-web.vercel.app`. The database is Neon serverless PostgreSQL (pooled via pgbouncer), with BullMQ on Upstash Redis for job queuing.

This document covers: (1) what was built, (2) current architecture state, (3) known issues, (4) scanner improvement roadmap.

---

## 1. What Was Built (Completed Work)

### Phase 1: Core Platform
- Full auth system (JWT + refresh tokens, Argon2 hashing, token rotation on password change)
- Scan pipeline: file upload → BullMQ job → static analysis → AI review → scoring → report
- Real-time progress via Socket.IO (WebSocket gateway)
- Frontend dashboard with scan submission, progress tracking, and report viewing
- Scoring engine with weighted category scores, severity deductions, auto-block conditions

### Phase 2: GitHub Integration
- GitHub App webhook (installation lifecycle, PR scan triggering, commit status posting, PR comments)
- HMAC signature verification for webhook security
- Rate limiting on GitHub API calls
- Repo config CRUD for per-repo scan settings
- 24 test suites, 183 tests passing

### Phase 3: User Experience & OAuth
- GitHub OAuth (connect account, list repos for scanning)
- Lark OAuth (login flow + settings connect flow)
- Profile page with password change
- Logout with refresh token revocation
- Connected accounts management (AES-256-GCM token encryption)
- GitHub repo picker UI on the scan creation page

### Phase 4: AI Providers
- `AI_REVIEWER_PROVIDER` DI token with factory pattern (`resolveAiProvider`)
- `GeminiProvider` (default, uses `gemini-2.5-flash`)
- `OllamaProvider` (alternative, configurable via `AI_PROVIDER=ollama` env)
- Retry logic (2 retries) with graceful degradation to mock results

### Phase 5: Production Hardening (Latest)
- **Lark email cleanup**: Synthetic `lark_*@slopshield.local` emails hidden from UI (sidebar + profile)
- **Lark auto-connect**: Login-via-Lark automatically creates ConnectedAccount (upsert pattern)
- **Prisma connection resilience**: `datasourceUrl` passthrough, error event listener, documented Neon pgbouncer URL format
- **DATABASE_URL updated on Render**: `?pgbouncer=true&connect_timeout=15&pool_timeout=15&connection_limit=5`

---

## 2. Current Architecture

### Backend (`apps/api`)

```
apps/api/src/
├── auth/                    # JWT auth, guards, password change
├── ai-reviewer/             # AI review orchestration + providers
│   ├── providers/
│   │   ├── gemini.provider.ts    # Google Gemini 2.5-flash
│   │   └── ollama.provider.ts    # Ollama cloud alternative
│   ├── prompts/
│   │   └── system-prompt.ts      # System prompt for AI review
│   └── ai-reviewer.service.ts    # DI-based provider dispatch
├── common/                  # env.ts (port, caps, readiness)
├── github-app/              # GitHub App webhooks + PR status checks
├── lark/                    # Lark notification cards
├── notification/            # Workspace alert dispatch
├── oauth/                   # GitHub + Lark OAuth services
│   ├── connected-account.service.ts  # CRUD + upsert + token encryption
│   ├── crypto.util.ts               # AES-256-GCM encrypt/decrypt
│   ├── github-oauth.service.ts      # GitHub OAuth flow
│   ├── lark-oauth.service.ts        # Lark OAuth (login + settings)
│   └── oauth.controller.ts          # Unified callback routing
├── prisma/                  # PrismaService (Neon-compatible)
├── report/                  # Report generation
├── rules/                   # Standards mapper
├── scan/                    # Scan pipeline (processor, gateway, service)
│   ├── scan.processor.ts           # BullMQ worker — full pipeline
│   ├── scan.gateway.ts             # Socket.IO progress broadcast
│   ├── scan.service.ts             # Scan creation + GitHub ingestion
│   └── github-ingestion.service.ts # Clone repos via GitHub API
├── scanner/                 # Scanner orchestrator
│   └── scanner.orchestrator.ts     # Parallel analyzer execution + timeout
└── scoring/                 # Weighted scoring engine
    └── scoring.service.ts          # Category deductions + auto-block
```

### Frontend (`apps/web`)

```
apps/web/src/
├── app/
│   ├── auth/           # Login, register, Lark callback
│   ├── dashboard/      # Main dashboard
│   ├── profile/        # Profile + connected accounts
│   ├── projects/       # Project management
│   ├── scans/
│   │   ├── new/        # Scan submission (file upload + GitHub repo picker)
│   │   └── [id]/
│   │       ├── progress/   # Real-time scan progress (Socket.IO)
│   │       └── report/     # Scan report viewer
│   └── settings/
├── components/
│   ├── layout/sidebar.tsx  # Navigation + user identity
│   └── scan-timeline.tsx   # Progress visualization
├── hooks/
│   ├── use-auth.ts         # Auth hooks (login, register, logout, me)
│   ├── use-oauth.ts        # Connected accounts + GitHub repos
│   ├── use-scans.ts        # Scan CRUD hooks
│   └── use-scan-progress.ts # Socket.IO progress hook
└── lib/
    ├── api-client.ts       # Axios wrapper with token refresh
    ├── socket.ts           # Socket.IO client config
    └── user-utils.ts       # isSyntheticEmail utility
```

### Shared Packages

```
packages/shared/          # Types, Zod schemas, constants, severity/category enums
packages/scanner-plugins/ # Static analyzer implementations
  └── src/analyzers/
      ├── eslint.analyzer.ts       # Runs ESLint on source files
      ├── typescript.analyzer.ts   # TypeScript compiler diagnostics
      ├── secret.analyzer.ts       # Regex-based secret detection
      ├── semgrep.analyzer.ts      # Semgrep rules (optional, skips if CLI absent)
      ├── slop.analyzer.ts         # AI slop pattern detection (4 rules)
      └── file-classifier.ts       # Classifies files by language/type/env
```

---

## 3. Key Configuration (Production)

### Render Environment Variables
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon PostgreSQL (pooled, with pgbouncer params) |
| `REDIS_URL` | Upstash Redis for BullMQ |
| `JWT_SECRET` | Access token signing |
| `REFRESH_SECRET` | Refresh token signing (must differ from JWT_SECRET) |
| `GEMINI_API_KEY` | Google Gemini API for AI review |
| `GITHUB_TOKEN` | GitHub API token for repo cloning |
| `GITHUB_OAUTH_CLIENT_ID/SECRET/CALLBACK_URL` | GitHub OAuth app |
| `LARK_OAUTH_APP_ID/SECRET/CALLBACK_URL` | Lark OAuth app |
| `OAUTH_ENCRYPTION_KEY` | AES-256-GCM key for token storage |
| `FRONTEND_URL` | `https://slopshield-ai-web.vercel.app` |
| `CORS_ORIGIN` | Same as FRONTEND_URL |
| `AI_PROVIDER` | `gemini` (default) or `ollama` |
| `MAX_ANALYZE_FILES` | Cap on files sent to heavy analyzers (default: 50) |
| `MAX_REPO_BYTES` | Max repo size for GitHub scan (default: 250MB) |

---

## 4. Known Issues & Technical Debt

| Issue | Severity | Details |
|-------|----------|---------|
| Semgrep unavailable on Render | Low | Semgrep CLI not installed on Render's Docker image. Analyzer gracefully skips. |
| AI review is the bottleneck | Medium | Gemini call takes 15-20s. Scan is sub-60s total but AI review dominates. |
| In-memory OAuth state store | Medium | `LarkOAuthService` uses a `Map<string, StateEntry>` — lost on restart. Should use Redis. |
| Slop analyzer has only 4 rules | Medium | Needs expansion to cover more AI-generated patterns. |
| No incremental/diff scanning | Low | Always scans full repo. PR-triggered scans should only scan changed files. |
| Render cold starts | Low | Free tier. 30-60s cold start on first request after idle. |
| `console.log` in analyzer code | Cosmetic | Some analyzers use `console.log` instead of NestJS Logger. |

---

## 5. Scanner Improvement Plan

### 5.1 Expand Slop Analyzer Rules

The current `slop.analyzer.ts` has only 4 pattern rules. A production-grade slop detector needs 20-30+ rules covering:

**Missing Implementation Patterns**
- `throw new Error('Not implemented')` / `throw new Error('TODO')`
- Empty function bodies (non-abstract)
- `return null` / `return undefined` as placeholder
- `// ... rest of implementation` style truncation

**AI Hallucination Indicators**
- Import from non-existent packages (e.g., `import { thing } from 'fictional-package'`)
- Function calls to undefined methods
- Variable declarations that shadow outer scope unnecessarily
- Overly generic variable names (`data`, `result`, `temp`, `item`, `thing`) in non-trivial contexts

**Copy-Paste Indicators**
- Repeated identical code blocks (>3 lines duplicated)
- Sequential numbered variables (`item1`, `item2`, `item3`, ...)
- Identical catch blocks across multiple try-catches

**Anti-Pattern Detection**
- `any` type annotations in TypeScript (when >3 in a single file)
- Nested ternaries (>2 levels deep)
- Functions over 50 lines
- Components over 200 lines
- More than 5 parameters in a function signature
- `eval()` or `new Function()`

### 5.2 Add Dependency Vulnerability Analyzer

New analyzer: `dependency.analyzer.ts`
- Parse `package.json` / `pnpm-lock.yaml` for known vulnerable packages
- Check for outdated major versions
- Detect typosquatting patterns (packages with names similar to popular ones)
- Flag packages with no GitHub repo or <100 weekly downloads

### 5.3 Add Architecture Analyzer

New analyzer: `architecture.analyzer.ts`
- Detect circular imports (via dependency graph)
- Flag files that import from too many modules (>10 imports = high coupling)
- Detect god classes (>500 lines)
- Detect barrel files that re-export everything (`index.ts` with only re-exports)
- Check for proper separation of concerns (controllers shouldn't import repositories directly)

### 5.4 Add Accessibility Analyzer

New analyzer: `a11y.analyzer.ts`
- Detect `<img>` without `alt` attribute
- Detect `<button>` without accessible label
- Detect color-only indicators (no aria-label)
- Detect missing `<label>` for form inputs
- Detect `onClick` on non-interactive elements without keyboard handler

### 5.5 Improve AI Review Performance

**Batch file processing**: Instead of sending all files in one prompt:
- Group files into batches of 3-5 based on relatedness (same directory)
- Process batches in parallel with `Promise.allSettled`
- Merge results after all batches complete
- Timeout per batch: 15s (instead of full 45s for one giant prompt)

**Streaming response**: Use Gemini's streaming API to emit findings as they arrive rather than waiting for the complete response.

**Context optimization**:
- Only send files that have meaningful logic (skip config files, package.json, lockfiles)
- Truncate files at 500 lines (most issues are in the first 200 lines)
- Include file dependency context (which files import this one) as metadata

### 5.6 Add Scanner Metrics & Observability

Track per-scan metrics:
- Time per analyzer (already captured in `durationMs`)
- File count per analyzer
- Finding count per category
- AI review token usage (input/output tokens)
- Scan queue wait time (enqueue → start processing)

Expose via:
- `GET /api/admin/scanner-metrics` endpoint
- Store in DB as `ScanMetrics` model
- Dashboard visualization in frontend

### 5.7 Add Incremental Scanning (Diff-Only)

For PR-triggered scans:
- Accept `changedFiles` list from the GitHub webhook payload
- Only run analyzers on changed files
- For AI review: include changed files + their direct imports as context
- Expected speedup: 3-5x for typical PRs (5-10 files vs 50+ full scan)

### 5.8 Add Custom Rule Engine

Allow users to define custom rules per-project:
- Rule format: `{ pattern: RegExp, severity, category, message }`
- Store in `ProjectConfig` model
- Load during scan from `repo-config` endpoint
- Apply as an additional analyzer pass after built-in analyzers

---

## 6. Scanner Pipeline Timing Breakdown (Observed)

From production logs for a 6-file scan:

| Stage | Duration | Notes |
|-------|----------|-------|
| File indexing | <100ms | Glob + classify |
| Static analysis (4 analyzers) | ~3.3s | ESLint dominates (3.3s), others <10ms |
| AI review (Gemini 2.5-flash) | ~19s | Single-file batch, one prompt |
| Scoring + persistence | <1s | Score calculation + Prisma writes |
| Notification | <1s | Lark card + workspace alerts |
| **Total** | **~24s** | Sub-60s target met |

**Bottleneck**: AI review (79% of total time). Fix: batch processing + streaming.

---

## 7. Database Schema (Key Models)

```prisma
model User { id, name, email, password, role, larkUserId, createdAt }
model RefreshToken { id, jti, userId, expiresAt, revokedAt }
model ConnectedAccount { id, userId, provider, providerAccountId, accessToken, refreshToken, tokenExpiresAt, displayName, status, @@unique([userId, provider]) }
model ScanJob { id, status, overallScore, *Scores, statusResult, aiSummary, refactorPlan, recommendedTests, analyzerCoverage, failureReason, completedAt }
model ScanFile { id, scanJobId, filePath, language, fileType, isFrontend, isBackend }
model Finding { id, scanJobId, filePath, lineNumber, severity, category, title, description, standardReference, recommendation, suggestedTests, blocking, confidence, source, codeSnippet }
model Project { id, name, repoUrl, config, userId }
model GithubAppInstallation { id, installationId, accountLogin, ... }
model RepoConfig { id, installationId, repoFullName, ... }
```

---

## 8. Deployment Workflow

```bash
# Backend (auto-deploy on push):
git add -A && git commit -m "feat: description" && git push origin main
# Render picks up the push and redeploys automatically

# Frontend (manual via Vercel CLI):
vercel --prod --yes
# From repo root — deploys apps/web to production
```

---

## 9. Testing Infrastructure

- **Framework**: Vitest (monorepo-wide)
- **Property tests**: fast-check for pure functions and invariants
- **Unit tests**: Service-level mocking with Prisma mock
- **Run all**: `pnpm test` from root
- **Run specific**: `pnpm --filter @slopshield/api test`
- **Current coverage**: 24 test suites, 183+ tests passing

---

## 10. Next Steps (Priority Order)

1. **Expand slop analyzer** to 20+ rules (highest impact, lowest effort)
2. **Batch AI review** for 3-5x speedup on large repos
3. **Incremental scanning** for PR workflows (changed files only)
4. **Redis-backed OAuth state** to survive Render restarts
5. **Architecture analyzer** for import graph and coupling detection
6. **Dependency vulnerability scanner** for supply chain security
7. **Custom rule engine** for per-project rule configuration
8. **Scanner metrics dashboard** for observability

---

## 11. Repository & Access

- **Repo**: `github.com/defnotwig/slopshield-ai` (branch: `main`)
- **Frontend**: `https://slopshield-ai-web.vercel.app`
- **Backend**: `https://slopshield-ai.onrender.com`
- **Neon DB**: `ep-withered-shadow-aoe1zz2z-pooler.c-2.ap-southeast-1.aws.neon.tech`
- **Specs**: `.kiro/specs/` (8 completed spec directories)
