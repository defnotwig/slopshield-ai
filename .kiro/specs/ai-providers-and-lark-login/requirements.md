# Requirements Document

## Introduction

This feature extends the SlopShield AI platform (NestJS backend on Render, Next.js frontend on Vercel) in three areas:

- **Part A — Pluggable AI provider:** Add an Ollama Cloud provider as an alternative to the existing Gemini provider, selectable through an `AI_PROVIDER` environment variable, while preserving the existing `AIReviewerProvider` interface, the `AIReviewResult` schema, outbound secret redaction, and per-scan cost caps.
- **Part B — Env-driven Gemini model:** Ensure the Gemini model identifier is fully driven by the `GEMINI_MODEL` environment variable, validated, and defaults to a cost-effective free-tier flash model to conserve quota.
- **Part C — Lark login:** Promote Lark OAuth from a settings-only connection into a first-class login method on the login page that provisions or finds a SlopShield user and issues the standard JWT access/refresh token pair, while keeping the existing settings-based Lark connection available for notifications.

The work reuses existing building blocks: the `AIReviewerProvider` interface, `redactSecrets`, the `capFiles`/`maxAnalyzeFiles` caps, `AuthService.issueTokens`, `LarkOAuthService`, and the `User.larkUserId` field.

## Glossary

- **AI_Reviewer_Service**: The backend service (`AIReviewerService`) that dispatches code review, fix-plan generation, and summary requests to the active AI provider.
- **AI_Provider**: Any implementation of the `AIReviewerProvider` interface (`reviewCode`, `generateFixPlan`, `summarizeForLark`). Concrete implementations are `Gemini_Provider` and `Ollama_Provider`.
- **Gemini_Provider**: The existing `GeminiProvider` that calls Google Gemini via `GoogleGenAI`.
- **Ollama_Provider**: The new `OllamaCloudProvider` that calls the Ollama Cloud OpenAI-compatible chat completions API using an API key.
- **Provider_Selector**: The factory/selector that resolves the active `AI_Provider` from the `AI_PROVIDER` environment variable.
- **AI_Review_Result**: The canonical result object validated by `AIReviewResultSchema` (summary, findings, recommended_tests, refactor_plan).
- **Secret_Redactor**: The existing `redactSecrets` function applied to all outbound content sent to an AI provider.
- **File_Cap**: The existing per-scan limit on analyzed files from `capFiles`/`maxAnalyzeFiles` (`MAX_ANALYZE_FILES`, default 50).
- **Auth_Service**: The backend `AuthService` that issues JWT access/refresh token pairs via `issueTokens`.
- **Lark_OAuth_Service**: The backend `LarkOAuthService` that performs the Lark OAuth 2.0 authorization-code flow.
- **OAuth_Controller**: The backend `OAuthController` exposing OAuth authorize/callback endpoints.
- **Connected_Account**: A stored OAuth provider connection (`ConnectedAccount`) used for notifications.
- **Login_Page**: The frontend page at `apps/web/src/app/auth/login/page.tsx`.
- **Lark_Callback_Page**: A frontend page that receives auth tokens after a successful Lark login callback and completes the session.
- **Token_Pair**: A JWT access token plus refresh token issued by `Auth_Service`.
- **AI_PROVIDER**: Environment variable selecting the active provider; values `"gemini"` (default) or `"ollama"`.
- **GEMINI_MODEL**: Environment variable specifying the Gemini model identifier.
- **OLLAMA_MODEL**: Environment variable specifying the Ollama Cloud model identifier.
- **OLLAMA_API_KEY**: Environment variable holding the Ollama Cloud API key.
- **OLLAMA_BASE_URL**: Environment variable specifying the Ollama Cloud OpenAI-compatible base URL.

## Requirements

### Requirement 1: Ollama Cloud Provider Implementation

**User Story:** As a platform operator, I want an Ollama Cloud AI reviewer provider, so that I can run code reviews through Ollama Cloud as an alternative to Gemini.

#### Acceptance Criteria

1. THE Ollama_Provider SHALL implement the `AIReviewerProvider` interface methods `reviewCode`, `generateFixPlan`, and `summarizeForLark`.
2. WHEN `reviewCode` completes, THE Ollama_Provider SHALL return an object that validates against `AIReviewResultSchema`.
3. WHEN the Ollama_Provider sends review, fix-plan, or summary content to the Ollama Cloud API, THE Ollama_Provider SHALL apply the Secret_Redactor to all outbound file content, findings text, and report content.
4. THE Ollama_Provider SHALL call the Ollama Cloud OpenAI-compatible chat completions endpoint resolved from `OLLAMA_BASE_URL` (default `https://ollama.com`) using `OLLAMA_API_KEY` as a bearer credential.
5. THE Ollama_Provider SHALL use the model identifier from `OLLAMA_MODEL`.
6. IF `OLLAMA_API_KEY` is absent or blank, THEN THE Ollama_Provider SHALL operate in mock mode and return a deterministic mock AI_Review_Result without calling the external API.
7. IF the Ollama Cloud API returns an error or unparseable response, THEN THE Ollama_Provider SHALL retry up to 2 additional attempts and SHALL surface a descriptive error only after all retry attempts are exhausted.
8. WHEN the Ollama Cloud response is received for `reviewCode`, THE Ollama_Provider SHALL parse the model output as JSON and validate it against `AIReviewResultSchema` before returning.

### Requirement 2: AI Provider Selection

**User Story:** As a platform operator, I want to choose which AI provider is active through configuration, so that I can switch between Gemini and Ollama without code changes.

#### Acceptance Criteria

1. WHERE `AI_PROVIDER` equals `"ollama"`, THE Provider_Selector SHALL supply the Ollama_Provider to the AI_Reviewer_Service.
2. WHERE `AI_PROVIDER` equals `"gemini"`, THE Provider_Selector SHALL supply the Gemini_Provider to the AI_Reviewer_Service.
3. IF `AI_PROVIDER` is absent or blank, THEN THE Provider_Selector SHALL supply the Gemini_Provider as the default.
4. IF `AI_PROVIDER` is set to an unrecognized value, THEN THE Provider_Selector SHALL supply the Gemini_Provider and attempt to log a warning identifying the unrecognized value, and SHALL continue operating with the Gemini_Provider even when the warning log attempt fails.
5. THE AI_Reviewer_Service SHALL depend on the `AIReviewerProvider` interface rather than a concrete provider class.

### Requirement 3: Per-Scan Cost Control

**User Story:** As a budget-conscious operator on a limited plan, I want each scan to bound the work sent to the AI provider, so that costs and quota usage stay predictable.

#### Acceptance Criteria

1. WHEN a scan dispatches files to any AI_Provider, THE AI_Reviewer_Service SHALL limit the number of files using the existing File_Cap (`MAX_ANALYZE_FILES`).
2. THE Ollama_Provider SHALL bound the total outbound content sent per scan to a configurable maximum character/token budget read from environment configuration with a cost-effective default.
3. WHILE outbound content exists for a scan and the combined outbound content exceeds the configured budget, THE Ollama_Provider SHALL truncate the content to remain within the budget before calling the Ollama Cloud API.
4. THE Ollama_Provider SHALL default `OLLAMA_MODEL` to a cost-effective model identifier when `OLLAMA_MODEL` is absent or blank.

### Requirement 4: Env-Driven Gemini Model

**User Story:** As a platform operator using the Google AI Studio free tier, I want the Gemini model to be configurable, so that I can select free-tier flash or pro models to conserve quota.

#### Acceptance Criteria

1. THE Gemini_Provider SHALL read the model identifier from `GEMINI_MODEL`.
2. IF `GEMINI_MODEL` is absent or blank, THEN THE Gemini_Provider SHALL use a cost-effective free-tier flash model identifier as the default.
3. WHEN the Gemini_Provider initializes, THE Gemini_Provider SHALL log the resolved model identifier.
4. THE configuration documentation SHALL list supported free-tier `GEMINI_MODEL` values including `gemini-2.0-flash`, `gemini-2.5-flash`, and `gemini-2.5-pro`.

### Requirement 5: Lark Login Option on Login Page

**User Story:** As a user, I want a "Sign in with Lark" option on the login page, so that I can authenticate using my Lark account.

#### Acceptance Criteria

1. THE Login_Page SHALL display a "Sign in with Lark" control.
2. WHEN a user activates the "Sign in with Lark" control, THE Login_Page SHALL direct the user to the Lark login authorization flow.
3. THE OAuth_Controller SHALL expose a login-mode Lark authorization endpoint that initiates the Lark OAuth flow without requiring an authenticated SlopShield session.
4. WHERE the existing settings-based Lark connect flow is used, THE OAuth_Controller SHALL continue to create a Connected_Account for notifications as before.

### Requirement 6: Lark Login Authentication and Provisioning

**User Story:** As a user signing in with Lark, I want the system to recognize or create my account and log me in, so that I land in the dashboard like a normal login.

#### Acceptance Criteria

1. WHEN the Lark login callback succeeds, THE Lark_OAuth_Service SHALL fetch the Lark account identity including Lark user id and, when available, email.
2. WHEN a SlopShield user already exists matching the Lark account by `larkUserId` or email, THE Auth_Service SHALL use that existing user for the session.
3. IF no SlopShield user matches the Lark account, THEN THE Auth_Service SHALL create a new user populated with the Lark identity including `larkUserId`.
4. WHEN the matching or newly created user is resolved, THE Auth_Service SHALL issue a Token_Pair using the standard `issueTokens` flow.
5. WHEN the Token_Pair is issued for a successful Lark login, THE OAuth_Controller SHALL redirect the user to the Lark_Callback_Page carrying the access and refresh tokens.
6. IF the Lark login callback fails verification, THEN THE OAuth_Controller SHALL redirect the user to the Login_Page with an authentication error indicator regardless of token status.

### Requirement 7: Frontend Lark Login Completion

**User Story:** As a user returning from Lark login, I want my session stored and to be taken to the dashboard, so that the experience matches a normal login.

#### Acceptance Criteria

1. WHEN the Lark_Callback_Page receives a valid access token and refresh token, THE Lark_Callback_Page SHALL persist both tokens using the same storage mechanism as email/password login.
2. WHEN the tokens are persisted, THE Lark_Callback_Page SHALL redirect the user to the dashboard.
3. IF the Lark_Callback_Page receives an authentication error indicator or is missing a required token, THEN THE Lark_Callback_Page SHALL redirect the user to the Login_Page with an error message.
4. IF persisting the tokens fails, THEN THE Lark_Callback_Page SHALL redirect the user to the Login_Page with a storage error message and SHALL NOT indicate a successful session.
