# Implementation Plan: User Experience & OAuth

## Overview

This plan implements six areas: logout button, user profile page, git repo scan fix, demo sample production fix, GitHub OAuth integration, and Lark OAuth integration. Tasks are ordered to build foundational data models first, then backend services, then frontend integration, wiring everything together incrementally.

## Tasks

- [x] 1. Data model and shared infrastructure
  - [x] 1.1 Add ConnectedAccount Prisma model and run migration
    - Add the `ConnectedAccount` model to `apps/api/prisma/schema.prisma` with fields: id, userId, provider, providerAccountId, accessToken, refreshToken, tokenExpiresAt, displayName, status, createdAt, updatedAt
    - Add `@@unique([userId, provider])` and `@@index([userId])` constraints
    - Add `connectedAccounts ConnectedAccount[]` relation to the User model
    - Generate and apply the Prisma migration
    - _Requirements: 7.1, 7.2_

  - [x] 1.2 Create ChangePasswordDto with Zod validation
    - Create `apps/api/src/auth/dto/change-password.dto.ts`
    - Define Zod schema requiring `currentPassword` (min 1 char) and `newPassword` (min 8 chars)
    - Export the inferred TypeScript type
    - _Requirements: 8.1, 8.2_

  - [x] 1.3 Add OAuth environment variables to env configuration
    - Add `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CALLBACK_URL`, `LARK_OAUTH_APP_ID`, `LARK_OAUTH_APP_SECRET`, `LARK_OAUTH_CALLBACK_URL`, and `OAUTH_ENCRYPTION_KEY` to `apps/api/src/common/env.ts` validation schema
    - Update `.env.example` with placeholder values
    - _Requirements: 5.1, 6.1, 7.3_

- [x] 2. Password change endpoint
  - [x] 2.1 Implement changePassword method in AuthService
    - Add `changePassword(userId: string, currentPassword: string, newPassword: string)` to `apps/api/src/auth/auth.service.ts`
    - Fetch user by ID, verify currentPassword with argon2, throw UnauthorizedException if invalid
    - Hash newPassword with argon2, update user record
    - Revoke all refresh tokens for the user (set `revokedAt = new Date()`)
    - Issue and return a fresh access/refresh token pair
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 2.2 Add PUT /auth/password endpoint in AuthController
    - Add `@UseGuards(JwtAuthGuard) @Put('password')` endpoint to `apps/api/src/auth/auth.controller.ts`
    - Parse and validate body using ChangePasswordDto Zod schema
    - Call `authService.changePassword` and return the token pair response
    - _Requirements: 8.1, 2.3, 2.4, 2.5_

  - [ ]\* 2.3 Write property test: Password verification gate (Property 1)
    - **Property 1: Password verification gate**
    - For any user with stored hash and any candidate password, password change succeeds iff argon2.verify returns true
    - Use `fast-check` with min 100 iterations
    - **Validates: Requirements 2.3, 8.2, 8.3**

  - [ ]\* 2.4 Write property test: Token revocation on password change (Property 2)
    - **Property 2: Token revocation on password change**
    - For any user with N non-revoked refresh tokens, after successful password change all N tokens have non-null revokedAt
    - Use `fast-check` with min 100 iterations
    - **Validates: Requirements 2.5, 8.5**

  - [ ]\* 2.5 Write property test: Password hash round-trip (Property 3)
    - **Property 3: Password hash round-trip**
    - For any valid new password (≥8 chars), after password change argon2.verify(updatedHash, newPassword) returns true
    - Use `fast-check` with min 100 iterations
    - **Validates: Requirements 8.4**

  - [ ]\* 2.6 Write property test: Password change returns valid token pair (Property 4)
    - **Property 4: Password change returns valid token pair**
    - For any successful password change, response contains valid JWT accessToken with correct sub claim and refreshToken with null revokedAt in DB
    - Use `fast-check` with min 100 iterations
    - **Validates: Requirements 8.6**

- [x] 3. Checkpoint - Core auth changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Connected Account service with encryption
  - [x] 4.1 Implement token encryption utility
    - Create `apps/api/src/oauth/crypto.util.ts`
    - Implement `encrypt(plaintext: string): string` using AES-256-GCM with random IV, returning `iv:authTag:ciphertext` (hex-encoded)
    - Implement `decrypt(encrypted: string): string` to reverse the encryption
    - Read key from `OAUTH_ENCRYPTION_KEY` env var (32 bytes hex-encoded)
    - _Requirements: 7.3_

  - [x] 4.2 Implement ConnectedAccountService
    - Create `apps/api/src/oauth/connected-account.service.ts`
    - Implement `create(data)` — encrypts tokens before persisting via Prisma
    - Implement `findByUserAndProvider(userId, provider)` — returns raw record
    - Implement `findAllByUser(userId)` — returns only display fields (provider, displayName, status, createdAt)
    - Implement `disconnect(userId, provider)` — deletes the record
    - Implement `markDisconnected(userId, provider)` — sets status to "disconnected"
    - Implement `getDecryptedToken(userId, provider)` — decrypts and returns tokens
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]\* 4.3 Write property test: Connected_Account stores all fields with encrypted tokens (Property 6)
    - **Property 6: Connected_Account stores all fields with encrypted tokens**
    - For any valid creation input, persisted accessToken and refreshToken differ from plaintext
    - Use `fast-check` with min 100 iterations
    - **Validates: Requirements 7.1, 7.3**

  - [ ]\* 4.4 Write property test: Connected_Account unique constraint (Property 7)
    - **Property 7: Connected_Account unique constraint per user per provider**
    - For any user and provider, second create with same (userId, provider) is rejected
    - Use `fast-check` with min 100 iterations
    - **Validates: Requirements 7.2**

  - [ ]\* 4.5 Write property test: Connected_Account display never exposes tokens (Property 8)
    - **Property 8: Connected_Account display never exposes tokens**
    - For any Connected_Account record, findAllByUser response contains only provider, displayName, status, createdAt
    - Use `fast-check` with min 100 iterations
    - **Validates: Requirements 7.4**

- [x] 5. GitHub OAuth integration
  - [x] 5.1 Implement GitHubOAuthService
    - Create `apps/api/src/oauth/github-oauth.service.ts`
    - Implement `getAuthorizationUrl(userId)` — builds GitHub OAuth URL with `repo` and `read:user` scopes, generates random state, stores state in cache with 10-min TTL
    - Implement `handleCallback(code, state)` — validates state, exchanges code for access token via POST to GitHub, fetches user profile, creates Connected_Account
    - Implement `listRepos(userId)` — retrieves decrypted token, calls GitHub API, returns repo list
    - Implement `disconnect(userId)` — delegates to ConnectedAccountService
    - Handle expired/revoked token → mark disconnected, return 401
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]\* 5.2 Write property test: OAuth URL generation contains scopes and state (Property 5 - GitHub)
    - **Property 5: OAuth URL generation contains scopes and state**
    - For any authenticated user, generated GitHub auth URL contains `repo`, `read:user` scopes and non-empty state
    - Use `fast-check` with min 100 iterations
    - **Validates: Requirements 5.2**

- [x] 6. Lark OAuth integration
  - [x] 6.1 Implement LarkOAuthService
    - Create `apps/api/src/oauth/lark-oauth.service.ts`
    - Implement `getAuthorizationUrl(userId)` — builds Lark OAuth URL with required scopes and CSRF state
    - Implement `handleCallback(code, state)` — validates state, exchanges code for access + refresh tokens, fetches user identity, creates Connected_Account
    - Implement `refreshToken(userId)` — attempts token refresh, marks disconnected on failure
    - Implement `disconnect(userId)` — delegates to ConnectedAccountService
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]\* 6.2 Write property test: OAuth URL generation contains scopes and state (Property 5 - Lark)
    - **Property 5: OAuth URL generation contains scopes and state**
    - For any authenticated user, generated Lark auth URL contains required scopes and non-empty state
    - Use `fast-check` with min 100 iterations
    - **Validates: Requirements 6.2**

- [ ] 7. OAuth controller and module wiring
  - [x] 7.1 Create OAuthController with all endpoints
    - Create `apps/api/src/oauth/oauth.controller.ts`
    - Implement `GET /oauth/github/authorize` (guarded) — returns auth URL
    - Implement `GET /oauth/github/callback` — handles code exchange and redirects to profile page
    - Implement `DELETE /oauth/github/disconnect` (guarded) — disconnects GitHub
    - Implement `GET /oauth/github/repos` (guarded) — lists repos
    - Implement `GET /oauth/lark/authorize` (guarded) — returns auth URL
    - Implement `GET /oauth/lark/callback` — handles code exchange and redirects to profile page
    - Implement `DELETE /oauth/lark/disconnect` (guarded) — disconnects Lark
    - _Requirements: 5.1, 5.7, 6.1, 6.7_

  - [x] 7.2 Create OAuthModule and register in AppModule
    - Create `apps/api/src/oauth/oauth.module.ts` exporting OAuthController, GitHubOAuthService, LarkOAuthService, ConnectedAccountService
    - Import OAuthModule in `apps/api/src/app.module.ts`
    - _Requirements: 5.1, 6.1_

- [x] 8. Checkpoint - Backend OAuth complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Fix demo sample scanning in production
  - [x] 9.1 Fix demo samples path resolution in ScanService
    - Modify `apps/api/src/scan/scan.service.ts` to resolve demo samples using `path.join(__dirname, '../../demo-samples', demoId)` with fallback to `path.join(process.cwd(), 'demo-samples', demoId)` for development
    - Add existence check — if directory not found, throw BadRequestException with "Demo sample folder {id} not found"
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 9.2 Include demo-samples in production build output
    - Update `apps/api/nest-cli.json` to add `demo-samples` as a compiler asset to be copied into `dist/`
    - _Requirements: 4.4_

- [x] 10. Fix git repository scan validation error
  - [x] 10.1 Create conditional file interceptor for scan endpoint
    - Create `apps/api/src/scan/conditional-file.interceptor.ts`
    - Implement a custom NestJS interceptor that only activates multer/FileInterceptor when Content-Type is multipart/form-data, passing through JSON requests untouched
    - Replace `@UseInterceptors(FileInterceptor('file'))` with the conditional interceptor on the createScan endpoint
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]\* 10.2 Write unit tests for conditional file interceptor
    - Test that JSON requests with `application/json` Content-Type pass through without multer processing
    - Test that multipart requests still get file parsed correctly
    - _Requirements: 3.2_

- [x] 11. Frontend: Sidebar logout and user info
  - [x] 11.1 Update Sidebar component with real user data and logout
    - Modify `apps/web/src/components/layout/sidebar.tsx`
    - Use the existing `useMe()` hook to fetch and display real user name and email (replace hardcoded values)
    - Implement logout button click handler: call `POST /auth/logout` with stored refresh token, clear localStorage tokens, redirect to `/auth/login`
    - On network failure during logout, still clear tokens and redirect (graceful degradation)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 12. Frontend: Profile page
  - [x] 12.1 Create Profile page with account info section
    - Create `apps/web/src/app/profile/page.tsx`
    - Fetch user data from `GET /auth/me` endpoint
    - Display name, email, role, and account creation date
    - Add navigation link to profile in sidebar
    - _Requirements: 2.1, 2.7_

  - [x] 12.2 Add password change form to Profile page
    - Add a form section with current password, new password, and confirm password fields
    - Submit to `PUT /auth/password` endpoint
    - Display inline error messages on failure (wrong password, validation errors)
    - On success, update stored tokens with the new pair from response
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x] 12.3 Add Connected Accounts section to Profile page
    - Display GitHub and Lark connection status (connected username or "Not connected")
    - Show "Connect GitHub" / "Connect Lark" buttons when not connected
    - Show connected username and "Disconnect" button when connected
    - Connect buttons open OAuth authorization URL; Disconnect buttons call DELETE endpoints
    - _Requirements: 2.6, 5.8, 5.9, 6.8, 6.9_

- [x] 13. Frontend: Fix repo scan request format
  - [x] 13.1 Verify and fix repo scan tab request format
    - Review `apps/web/src/app/scans/new/page.tsx` repo tab submission logic
    - Ensure sourceType is set to "repository" and sourceRef is set to the URL
    - Confirm `apiClient.post` sends it as JSON (not FormData) with application/json Content-Type
    - Add validation that sourceRef is not empty before submission
    - _Requirements: 3.1, 3.2_

- [x] 14. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses TypeScript throughout (NestJS backend, Next.js frontend)
- Token encryption uses AES-256-GCM via Node.js crypto module
- OAuth state is stored server-side with 10-minute TTL for CSRF protection

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "4.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "2.6", "4.3", "4.4", "4.5"] },
    { "id": 4, "tasks": ["5.1", "6.1"] },
    { "id": 5, "tasks": ["5.2", "6.2", "7.1"] },
    { "id": 6, "tasks": ["7.2"] },
    { "id": 7, "tasks": ["9.1", "9.2", "10.1"] },
    { "id": 8, "tasks": ["10.2", "11.1", "13.1"] },
    { "id": 9, "tasks": ["12.1"] },
    { "id": 10, "tasks": ["12.2", "12.3"] }
  ]
}
```
