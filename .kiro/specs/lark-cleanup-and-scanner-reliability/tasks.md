# Implementation Plan: Lark Cleanup and Scanner Reliability

## Overview

Three targeted fixes across the SlopShield AI monorepo: (1) a shared utility to detect and hide synthetic Lark emails in the frontend, (2) auto-creation of ConnectedAccount records during Lark login in the backend, and (3) Prisma connection resilience for Neon serverless PostgreSQL. Tasks are ordered utility-first, then frontend, then backend, then Prisma infrastructure.

## Tasks

- [ ] 1. Create shared email utility
  - [ ] 1.1 Create `apps/web/src/lib/user-utils.ts` with `isSyntheticEmail` function
    - Export a pure function that returns `true` if the email is null, undefined, or matches `/@slopshield\.local$/`
    - Return `false` for all other string values
    - _Requirements: 1.1, 2.1_

  - [ ]* 1.2 Write property test for `isSyntheticEmail`
    - **Property 1: Synthetic email detection is consistent with the regex pattern**
    - For any string `email`, `isSyntheticEmail(email)` returns `true` iff the email is null, undefined, empty, or matches `/@slopshield\.local$/`
    - Create test file at `apps/web/src/lib/user-utils.test.ts` using vitest
    - **Validates: Requirements 1.1, 2.1**

- [ ] 2. Update frontend components to hide synthetic emails
  - [ ] 2.1 Update Sidebar to suppress synthetic email display
    - In `apps/web/src/components/layout/sidebar.tsx`, import `isSyntheticEmail` from `@/lib/user-utils`
    - Compute `hasSyntheticEmail` from `user?.email`
    - Set `displayEmail` to empty string when synthetic
    - Set `displayName` to `user?.name` (falling back to "User") when email is synthetic, avoiding fallback to synthetic email
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 2.2 Update Profile page to show dash for synthetic email
    - In `apps/web/src/app/profile/page.tsx`, import `isSyntheticEmail` from `@/lib/user-utils`
    - Render "—" in the email field when `isSyntheticEmail(user?.email)` is true
    - Display real email unchanged when not synthetic
    - _Requirements: 2.1, 2.2, 2.3_

- [ ] 3. Checkpoint - Verify frontend changes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Extend Lark OAuth service to return tokens
  - [ ] 4.1 Update `LarkOAuthService.handleLoginCallback` return type
    - In `apps/api/src/auth/lark-oauth.service.ts`, define `LarkLoginResult` interface with `larkUserId`, `email`, `name`, `accessToken`, `refreshToken`, `tokenExpiresAt`
    - Modify `handleLoginCallback` to return the full `LarkLoginResult` including tokens from the token exchange response
    - Use `.js` extension in any new imports (ESM)
    - _Requirements: 3.1, 3.2_

- [ ] 5. Add ConnectedAccount upsert capability
  - [ ] 5.1 Add `upsert` method to `ConnectedAccountService`
    - In `apps/api/src/connected-accounts/connected-accounts.service.ts`, add `UpsertConnectedAccountInput` interface
    - Implement `upsert` method using Prisma's `upsert` with `where: { userId_provider: { userId, provider } }`
    - Encrypt tokens before storing using the existing `encrypt` utility
    - On update: refresh `providerAccountId`, tokens, `tokenExpiresAt`, `displayName`, and set `status: 'connected'`
    - On create: set all fields including provider and userId
    - _Requirements: 3.2, 3.3_

  - [ ]* 5.2 Write property test for ConnectedAccount upsert idempotence
    - **Property 2: ConnectedAccount upsert idempotence**
    - For any user ID and provider pair, calling `upsert` multiple times with different token values always results in exactly one record with the latest tokens
    - Create test in `apps/api/src/connected-accounts/connected-accounts.service.spec.ts` using vitest
    - **Validates: Requirements 3.3**

- [ ] 6. Wire auto-connect into OAuth controller login flow
  - [ ] 6.1 Update `OAuthController.handleLarkCallback` to upsert ConnectedAccount after login
    - In `apps/api/src/auth/oauth.controller.ts`, inject `ConnectedAccountService` if not already available
    - After successful `findOrCreateLarkUser` and `loginWithUser`, call `connectedAccountService.upsert` with the identity tokens
    - Wrap the upsert call in a try/catch — log a warning on failure but do NOT block the login redirect
    - _Requirements: 3.1, 3.4, 3.5_

  - [ ]* 6.2 Write unit tests for OAuth controller Lark login + auto-connect
    - Test that login succeeds even when `upsert` throws an error
    - Test that `upsert` is called with correct parameters on successful login
    - _Requirements: 3.5_

- [ ] 7. Checkpoint - Verify backend changes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Improve Prisma connection resilience for Neon
  - [ ] 8.1 Update `PrismaService` constructor and lifecycle methods
    - In `apps/api/src/prisma/prisma.service.ts`, pass `datasourceUrl: process.env.DATABASE_URL` in the `super()` constructor call
    - Add `$on('error')` listener in `onModuleInit` that logs connection events via `Logger.warn`
    - Update the error message in the `$connect()` catch block to document required Neon URL format: `?pgbouncer=true&connect_timeout=15&pool_timeout=15&connection_limit=5`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3_

- [ ] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design
- The `userId_provider` compound unique key is used in Prisma upsert `where` clauses
- Frontend imports use the `@/` path alias; backend imports use `.js` extensions (ESM)
- No Prisma schema migration is needed — the existing `ConnectedAccount` model has all required fields

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2"] },
    { "id": 2, "tasks": ["4.1", "8.1"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1"] },
    { "id": 5, "tasks": ["6.2"] }
  ]
}
```
