# Implementation Plan: AI Providers and Lark Login

## Overview

This plan implements three areas in incremental, integrated steps across the NestJS backend (`apps/api`) and Next.js frontend (`apps/web`):

1. **Part A** — Ollama Cloud provider + env-driven provider selection (DI token + factory) + per-scan cost caps.
2. **Part B** — Env-driven Gemini model with a cost-effective free-tier flash default.
3. **Part C** — Lark login: unauthenticated authorize + login-mode callback that provisions/finds a user and issues JWT tokens, plus the frontend login button and callback page.

Each step ends wired into the running app. Property tests follow the 8 correctness properties in the design and use `fast-check` (min 100 iterations).

## Tasks

- [ ] 1. Part B: Env-driven Gemini model
  - [ ] 1.1 Add `resolveGeminiModel` helper and flash default to GeminiProvider
    - In `apps/api/src/ai-reviewer/providers/gemini.provider.ts`, add `resolveGeminiModel(raw: string | undefined): string` returning the trimmed value, or `"gemini-2.5-flash"` when absent/blank/whitespace-only
    - Use it to set `this.modelName` from `GEMINI_MODEL`; always log the resolved model on init
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 1.2 Write property test for Gemini model resolution (Property 7)
    - **Property 7: Gemini model resolution**
    - File: `apps/api/src/ai-reviewer/providers/gemini-model.property.spec.ts`, fast-check, min 100 iterations
    - For any GEMINI_MODEL value, assert flash default when absent/blank/whitespace, else trimmed value
    - **Validates: Requirements 4.1, 4.2**

  - [ ] 1.3 Document supported free-tier Gemini models
    - In `.env.example`, document `GEMINI_MODEL` supported free-tier values: `gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-2.5-pro`
    - _Requirements: 4.4_

- [ ] 2. Part A: Ollama Cloud provider
  - [ ] 2.1 Implement OllamaCloudProvider
    - Create `apps/api/src/ai-reviewer/providers/ollama.provider.ts` implementing `AIReviewerProvider` (`reviewCode`, `generateFixPlan`, `summarizeForLark`)
    - Read config: `OLLAMA_API_KEY`, `OLLAMA_BASE_URL` (default `https://ollama.com`), `OLLAMA_MODEL` (default `gpt-oss:20b`), `OLLAMA_MAX_OUTBOUND_CHARS` (default 60000)
    - Apply `redactSecrets` to all outbound content; truncate combined outbound content to the budget
    - POST `{baseUrl}/v1/chat/completions` with Bearer key, system+user messages, `response_format: json_object`
    - Parse `choices[0].message.content` as JSON, validate against `AIReviewResultSchema`
    - Mock mode (no key) returns deterministic schema-valid result; 3-attempt retry then descriptive error
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.2, 3.3, 3.4_

  - [ ]* 2.2 Write property test: reviewCode output validates schema (Property 1)
    - **Property 1: reviewCode output always validates against the schema**
    - File: `apps/api/src/ai-reviewer/providers/ollama.provider.property.spec.ts`, fast-check, 100+ iterations
    - **Validates: Requirements 1.2, 1.8**

  - [ ]* 2.3 Write property test: outbound content secret-redacted (Property 2)
    - **Property 2: All outbound content is secret-redacted**
    - **Validates: Requirements 1.3**

  - [ ]* 2.4 Write property test: retry then descriptive error (Property 3)
    - **Property 3: Retry then descriptive error after exhaustion**
    - **Validates: Requirements 1.7**

  - [ ]* 2.5 Write property test: outbound budget never exceeded (Property 6)
    - **Property 6: Outbound content never exceeds the configured budget**
    - **Validates: Requirements 3.2, 3.3**

- [ ] 3. Part A: Provider selection
  - [ ] 3.1 Add AI_REVIEWER_PROVIDER token and resolveAiProvider factory
    - Create `apps/api/src/ai-reviewer/ai-reviewer.constants.ts` exporting `AI_REVIEWER_PROVIDER` symbol
    - Create `apps/api/src/ai-reviewer/providers/provider.factory.ts` with pure `resolveAiProvider(raw, gemini, ollama, logger?)`: trimmed/case-insensitive — `"ollama"` → ollama, `"gemini"`/blank → gemini, unknown → warn-and-gemini (never throw even if logger throws)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.2 Wire provider selection into AIReviewerModule and AIReviewerService
    - In `apps/api/src/ai-reviewer/ai-reviewer.module.ts`, register `GeminiProvider`, `OllamaCloudProvider`, and the `AI_REVIEWER_PROVIDER` provider via `useFactory` (inject ConfigService + both providers)
    - In `apps/api/src/ai-reviewer/ai-reviewer.service.ts`, change constructor to `@Inject(AI_REVIEWER_PROVIDER) private readonly provider: AIReviewerProvider`
    - _Requirements: 2.5_

  - [ ]* 3.3 Write property test: provider selection mapping (Property 4)
    - **Property 4: Provider selection mapping is total and resilient**
    - File: `apps/api/src/ai-reviewer/providers/provider-factory.property.spec.ts`, fast-check, 100+ iterations
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [ ]* 3.4 Write property test: file cap prefix invariant (Property 5)
    - **Property 5: File cap is an order-preserving prefix within bound**
    - **Validates: Requirements 3.1**

  - [ ] 3.5 Add AI provider env vars to .env.example and render.yaml
    - Add `AI_PROVIDER`, `OLLAMA_API_KEY`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_MAX_OUTBOUND_CHARS` to `.env.example` and as `sync: false` (or defaults) in `render.yaml`
    - _Requirements: 2.1, 3.2, 3.4_

- [ ] 4. Checkpoint - AI provider layer
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Part C: Lark login backend
  - [ ] 5.1 Add login-mode methods to LarkOAuthService
    - In `apps/api/src/oauth/lark-oauth.service.ts`, add `getLoginAuthorizationUrl(): { url, state }` (login-mode state, no userId) and `handleLoginCallback(code, state): Promise<{ larkUserId, email?, name }>`
    - Extend `fetchUserInfo` to surface optional `email`
    - _Requirements: 5.3, 6.1_

  - [ ] 5.2 Add findOrCreateLarkUser and token issuance to AuthService
    - In `apps/api/src/auth/auth.service.ts`, add `findOrCreateLarkUser(identity)`: match by `larkUserId`, else by `email` (backfill larkUserId), else create user (random unusable password, role developer)
    - Expose a public `loginWithUser(user)` that calls `issueTokens(user)`
    - _Requirements: 6.2, 6.3, 6.4_

  - [ ] 5.3 Add Lark login endpoints to OAuthController
    - Add unauthenticated `GET /oauth/lark/login` → `{ url }` and `GET /oauth/lark/login/callback`
    - Callback: `handleLoginCallback` → `findOrCreateLarkUser` → `loginWithUser` → redirect `{FRONTEND_URL}/auth/lark/callback?accessToken=...&refreshToken=...`
    - On any failure redirect `{FRONTEND_URL}/auth/login?error=lark_auth_failed`
    - Keep existing settings connect flow (`/oauth/lark/authorize`, `/oauth/lark/callback`) unchanged
    - _Requirements: 5.3, 5.4, 6.4, 6.5, 6.6_

  - [ ]* 5.4 Write property test: Lark provisioning idempotent (Property 8)
    - **Property 8: Lark provisioning is idempotent by identity**
    - File: `apps/api/src/auth/lark-provisioning.property.spec.ts`, fast-check, 100+ iterations
    - **Validates: Requirements 6.2, 6.3**

- [ ] 6. Part C: Lark login frontend
  - [ ] 6.1 Add "Sign in with Lark" to the login page
    - In `apps/web/src/app/auth/login/page.tsx`, add a "Sign in with Lark" button that calls `GET /oauth/lark/login` then `window.location.assign(url)`
    - Read `?error=` query param to surface a Lark auth error message
    - _Requirements: 5.1, 5.2_

  - [ ] 6.2 Create the Lark callback page
    - Create `apps/web/src/app/auth/lark/callback/page.tsx`: read `accessToken`/`refreshToken` from query; if missing or `?error` present → redirect `/auth/login?error=...`
    - Persist both tokens via the shared `persistTokens` mechanism; on failure redirect `/auth/login?error=storage` and do not indicate success
    - Strip tokens from URL (`history.replaceState`) and redirect to `/dashboard`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP.
- Property tests use `fast-check` (min 100 iterations) tagged `// Feature: ai-providers-and-lark-login, Property {n}: {text}`.
- The tokens-in-URL handoff for Lark login is a documented tradeoff; the callback page strips the query string immediately.
- No database schema changes — the existing `User.larkUserId` field is reused.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "2.3", "2.4", "2.5", "3.1", "5.2", "6.2"] },
    { "id": 2, "tasks": ["3.2", "3.5", "5.3"] },
    { "id": 3, "tasks": ["3.3", "3.4", "5.4"] }
  ]
}
```
