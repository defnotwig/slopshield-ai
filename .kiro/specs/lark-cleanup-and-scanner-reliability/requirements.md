# Requirements Document

## Introduction

This feature addresses three production issues in SlopShield AI: (1) synthetic Lark emails (`lark_*@slopshield.local`) leaking into the user interface, (2) missing ConnectedAccount records when users log in via Lark OAuth, and (3) Prisma connection drops on Neon serverless PostgreSQL after scanner operations complete. Together these fixes improve identity presentation, OAuth account linking consistency, and database reliability for the scanner pipeline.

## Glossary

- **Frontend**: The Next.js web application (`apps/web`) serving the user interface
- **Sidebar**: The persistent navigation component displaying user identity and navigation links
- **Profile_Page**: The `/profile` route displaying account information, password management, and connected accounts
- **Synthetic_Email**: A fallback email address matching the pattern `lark_<id>@slopshield.local`, generated when a Lark user has no real email
- **Auth_Service**: The NestJS service (`auth.service.ts`) responsible for user creation, authentication, and token issuance
- **Lark_OAuth_Service**: The NestJS service (`lark-oauth.service.ts`) managing Lark OAuth flows including login and settings connect
- **OAuth_Controller**: The NestJS controller (`oauth.controller.ts`) handling OAuth callback routing for both login and settings flows
- **ConnectedAccount**: A Prisma database record linking a user to an external OAuth provider with tokens and display name
- **ConnectedAccount_Service**: The NestJS service managing CRUD operations on ConnectedAccount records
- **Prisma_Service**: The NestJS service (`prisma.service.ts`) extending PrismaClient for database lifecycle management
- **Neon_PostgreSQL**: The serverless PostgreSQL provider used in production, which aggressively closes idle connections
- **Scanner**: The background process that analyzes repository code for quality issues, executing database operations during and after scans

## Requirements

### Requirement 1: Hide Synthetic Email in Sidebar

**User Story:** As a Lark-authenticated user, I want the sidebar to hide my synthetic placeholder email, so that I see a clean interface without confusing internal system addresses.

#### Acceptance Criteria

1. WHEN the Sidebar renders user identity, THE Frontend SHALL treat any email matching the pattern `/@slopshield\.local$/` as absent.
2. WHILE a user has a Synthetic_Email, THE Sidebar SHALL display an empty string in the email line instead of the synthetic address.
3. WHILE a user has a Synthetic_Email, THE Sidebar SHALL use the user's name for the display name rather than falling back to the synthetic email.
4. WHEN a user has a real email address, THE Sidebar SHALL continue displaying the email unchanged.

### Requirement 2: Hide Synthetic Email in Profile Page

**User Story:** As a Lark-authenticated user, I want the profile page to show a dash placeholder instead of my synthetic email, so that the account information section remains informative without exposing internal system data.

#### Acceptance Criteria

1. WHEN the Profile_Page renders account information, THE Frontend SHALL treat any email matching the pattern `/@slopshield\.local$/` as absent.
2. WHILE a user has a Synthetic_Email, THE Profile_Page SHALL display "—" in the email field.
3. WHEN a user has a real email address, THE Profile_Page SHALL display the real email unchanged.

### Requirement 3: Auto-Create ConnectedAccount on Lark Login

**User Story:** As a user logging in via Lark OAuth, I want my Lark account to appear as connected on the profile page immediately after login, so that I can see my Lark identity and manage the connection without a separate linking step.

#### Acceptance Criteria

1. WHEN a user completes the Lark login OAuth callback successfully, THE OAuth_Controller SHALL create a ConnectedAccount record for that user with provider "lark".
2. WHEN creating the ConnectedAccount during login, THE Lark_OAuth_Service SHALL store the Lark access token, refresh token, token expiry, and the user's Lark display name.
3. IF a ConnectedAccount for provider "lark" already exists for the user, THEN THE Lark_OAuth_Service SHALL update the existing record with fresh tokens instead of creating a duplicate.
4. WHEN the ConnectedAccount is created during login, THE Profile_Page SHALL display "Connected as <name>" for the Lark provider on the next page load.
5. IF the ConnectedAccount creation fails, THEN THE OAuth_Controller SHALL still complete the login redirect successfully without blocking authentication.

### Requirement 4: Neon Serverless Connection Pool Reliability

**User Story:** As a system operator, I want the Prisma database connection to remain stable on Neon serverless PostgreSQL, so that scanner operations complete without "Error { kind: Closed, cause: None }" connection drops.

#### Acceptance Criteria

1. THE Prisma_Service SHALL configure connection pooling parameters compatible with Neon serverless PostgreSQL in the PrismaClient constructor.
2. THE Prisma_Service SHALL set a connection timeout of at least 15 seconds to accommodate Neon cold starts.
3. THE Prisma_Service SHALL limit the connection pool size to a value appropriate for serverless environments to prevent connection exhaustion.
4. WHEN the datasource URL contains pgbouncer connection pooling parameters, THE Prisma_Service SHALL pass those parameters through to the underlying database driver.
5. IF a database connection is dropped during operation, THEN THE Prisma_Service SHALL log a warning with the error details for observability.

### Requirement 5: Scanner Database Connection Stability

**User Story:** As a developer running code scans, I want scan operations to complete without database connection errors, so that scan results are reliably persisted and reported.

#### Acceptance Criteria

1. WHILE a scan operation is in progress, THE Scanner SHALL maintain a stable database connection throughout the scan lifecycle.
2. WHEN the Scanner completes analysis, THE Scanner SHALL persist results without encountering connection-closed errors caused by idle connection timeouts.
3. THE Prisma_Service SHALL configure a pool timeout that exceeds the maximum expected idle period between scanner database operations.
