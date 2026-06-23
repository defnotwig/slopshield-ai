# Requirements Document

## Introduction

This feature addresses critical UX gaps and adds OAuth-based integrations to the SlopShield AI platform. It covers: adding a logout button to the UI, building a user profile/settings page, fixing the git repository scan 400 error, fixing demo sample failures in production, implementing GitHub OAuth for private repository access, and implementing Lark OAuth for company notifications.

## Glossary

- **Frontend**: The Next.js 15 web application deployed at slopshield-ai-web.vercel.app
- **Backend**: The NestJS API server deployed at slopshield-ai.onrender.com/api
- **Sidebar**: The fixed left navigation panel containing links and user info
- **Auth_Service**: The NestJS authentication service handling login, register, token refresh, and logout
- **Scan_Service**: The NestJS service that creates scan jobs, ingests source code, and queues pipeline processing
- **OAuth_Provider**: An external service (GitHub or Lark) that issues authorization codes and access tokens via the OAuth 2.0 protocol
- **Connected_Account**: A database record linking a SlopShield user to an external OAuth provider account
- **Profile_Page**: The frontend page where users view and manage their account information
- **Demo_Sample_Directory**: The folder containing pre-built intentionally flawed code samples used for demonstration scans
- **GitHub_OAuth_Module**: The backend module implementing the GitHub OAuth 2.0 authorization code flow
- **Lark_OAuth_Module**: The backend module implementing the Lark OAuth 2.0 authorization code flow

## Requirements

### Requirement 1: Logout Button in UI

**User Story:** As a logged-in user, I want a visible logout button in the sidebar, so that I can sign out of my account securely.

#### Acceptance Criteria

1. THE Sidebar SHALL display a logout button that is visible and accessible to authenticated users
2. WHEN the user clicks the logout button, THE Frontend SHALL call the backend logout endpoint with the stored refresh token
3. WHEN the logout request completes, THE Frontend SHALL clear all stored tokens from local storage
4. WHEN the logout request completes, THE Frontend SHALL redirect the user to the login page
5. IF the backend logout endpoint is unreachable, THEN THE Frontend SHALL still clear local tokens and redirect to the login page
6. THE Sidebar SHALL display the current user name and email fetched from the authenticated user profile

### Requirement 2: User Profile Page

**User Story:** As a logged-in user, I want a profile page where I can view my account details and change my password, so that I can manage my identity.

#### Acceptance Criteria

1. THE Profile_Page SHALL display the user name, email, role, and account creation date
2. THE Profile_Page SHALL provide a form to change the user password
3. WHEN the user submits a valid password change request, THE Backend SHALL verify the current password before applying the new password
4. IF the current password is incorrect during a password change, THEN THE Backend SHALL return a 401 error with a descriptive message
5. WHEN the password is changed successfully, THE Backend SHALL revoke all existing refresh tokens for the user
6. THE Profile_Page SHALL display connected OAuth accounts (GitHub, Lark) with their connection status
7. WHEN the user navigates to the Profile_Page, THE Frontend SHALL fetch profile data from the GET /auth/me endpoint

### Requirement 3: Fix Git Repository Scan Validation Error

**User Story:** As a user, I want to scan a public GitHub repository by providing its URL, so that I can get a quality report without encountering validation errors.

#### Acceptance Criteria

1. WHEN the user submits a repository scan from the "Git Repo" tab, THE Frontend SHALL send a JSON body with sourceType set to "repository" and sourceRef set to the provided URL
2. THE Frontend SHALL send the repository scan request as application/json content type, not multipart/form-data
3. WHEN the backend receives a repository scan request with a valid GitHub URL, THE Scan_Service SHALL accept the request and create a scan job
4. IF the sourceRef field is empty or missing for a repository scan, THEN THE Backend SHALL return HTTP 400 with a message indicating the repository URL is required

### Requirement 4: Fix Demo Sample Scanning in Production

**User Story:** As a user, I want demo sample scans to work in production, so that I can test the platform without providing my own code.

#### Acceptance Criteria

1. THE Backend SHALL resolve the demo samples directory relative to the deployed application root using a path that works in both development and production environments
2. WHEN a demo sample scan is requested with a valid sample ID, THE Scan_Service SHALL locate and copy the sample files into the scan directory
3. IF the requested demo sample directory does not exist at the resolved path, THEN THE Scan_Service SHALL return HTTP 400 with a message indicating the sample was not found
4. THE build configuration SHALL include the demo-samples directory in the production deployment artifact

### Requirement 5: GitHub OAuth Integration

**User Story:** As a user, I want to connect my GitHub account via OAuth, so that I can list and scan my private repositories.

#### Acceptance Criteria

1. THE GitHub_OAuth_Module SHALL implement the OAuth 2.0 authorization code flow with GitHub as the OAuth_Provider
2. WHEN the user initiates GitHub connection, THE Backend SHALL generate an authorization URL with the required scopes (repo, read:user) and a CSRF state parameter
3. WHEN GitHub redirects back with an authorization code, THE Backend SHALL exchange the code for an access token
4. WHEN the access token is obtained, THE Backend SHALL store a Connected_Account record linking the GitHub user to the SlopShield user
5. THE Backend SHALL provide an endpoint to list the authenticated user GitHub repositories using the stored access token
6. IF the stored GitHub access token is expired or revoked, THEN THE Backend SHALL return HTTP 401 and mark the Connected_Account as disconnected
7. WHEN the user disconnects their GitHub account, THE Backend SHALL delete the Connected_Account record and discard the stored token
8. THE Profile_Page SHALL display a "Connect GitHub" button when no GitHub account is connected
9. WHEN a GitHub account is connected, THE Profile_Page SHALL display the connected GitHub username and a "Disconnect" button

### Requirement 6: Lark OAuth Integration

**User Story:** As a user, I want to connect my Lark account via OAuth, so that I can receive scan notifications in my company Lark workspace.

#### Acceptance Criteria

1. THE Lark_OAuth_Module SHALL implement the OAuth 2.0 authorization code flow with Lark as the OAuth_Provider
2. WHEN the user initiates Lark connection, THE Backend SHALL generate an authorization URL with the required scopes and a CSRF state parameter
3. WHEN Lark redirects back with an authorization code, THE Backend SHALL exchange the code for an access token and user identity
4. WHEN the Lark access token is obtained, THE Backend SHALL store a Connected_Account record linking the Lark user ID to the SlopShield user
5. IF the stored Lark access token is expired, THEN THE Backend SHALL attempt to refresh the token using the stored refresh token
6. IF the Lark token refresh fails, THEN THE Backend SHALL mark the Connected_Account as disconnected and return HTTP 401
7. WHEN the user disconnects their Lark account, THE Backend SHALL delete the Connected_Account record and discard stored tokens
8. THE Profile_Page SHALL display a "Connect Lark" button when no Lark account is connected
9. WHEN a Lark account is connected, THE Profile_Page SHALL display the connected Lark username and a "Disconnect" button

### Requirement 7: Connected Accounts Data Model

**User Story:** As the system, I need a data model to persist OAuth connections, so that users can maintain persistent links to external services.

#### Acceptance Criteria

1. THE Backend SHALL store Connected_Account records with: id, userId, provider (github or lark), providerAccountId, accessToken (encrypted), refreshToken (encrypted), tokenExpiresAt, displayName, and connection status
2. THE Backend SHALL enforce a unique constraint on the combination of userId and provider so each user has at most one connection per provider
3. WHEN a Connected_Account is created, THE Backend SHALL encrypt the access token and refresh token before persisting
4. WHEN a Connected_Account is read for display purposes, THE Backend SHALL return only the displayName, provider, status, and connection date without exposing tokens

### Requirement 8: Password Change Endpoint

**User Story:** As a logged-in user, I want an API endpoint to change my password, so that I can update my credentials securely.

#### Acceptance Criteria

1. THE Auth_Service SHALL provide a PUT /auth/password endpoint that requires authentication
2. WHEN the endpoint receives a valid request with currentPassword and newPassword, THE Auth_Service SHALL verify the current password using argon2
3. IF the current password verification fails, THEN THE Auth_Service SHALL return HTTP 401 with "Current password is incorrect"
4. WHEN the current password is verified, THE Auth_Service SHALL hash the new password with argon2 and update the user record
5. WHEN the password is updated, THE Auth_Service SHALL revoke all existing refresh tokens for the user
6. WHEN the password is updated, THE Auth_Service SHALL return the new token pair so the user remains logged in on the current device
