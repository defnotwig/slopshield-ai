# Design Document

## Overview

This feature applies three targeted fixes across the SlopShield AI monorepo: (1) hiding synthetic Lark emails from the UI, (2) auto-creating ConnectedAccount records during Lark login, and (3) improving Prisma connection resilience for Neon serverless PostgreSQL.

## Architecture

This feature applies three targeted fixes across the SlopShield AI monorepo:

1. **Frontend email filtering** — A shared utility function (`isSyntheticEmail`) checks emails against the `/@slopshield\.local$/` pattern. Both the Sidebar and Profile page import this function to suppress synthetic addresses in the UI.

2. **Auto-connect Lark on login** — The existing `handleLoginCallback` in `LarkOAuthService` is extended to return Lark tokens alongside the identity. The `OAuthController` uses those tokens to upsert a `ConnectedAccount` record immediately after login succeeds, wrapped in a try/catch so failures don't block authentication.

3. **Prisma connection resilience** — `PrismaService` is updated to pass `datasourceUrl` from the environment and document the required Neon connection string format (`?pgbouncer=true&connect_timeout=15&pool_timeout=15&connection_limit=5`). An `$on('error')` listener logs connection drops for observability.

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web                                                       │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │  sidebar.tsx  │   │ profile/page │   │ lib/user-utils.ts  │  │
│  │  (imports)    │──▶│  (imports)   │──▶│ isSyntheticEmail() │  │
│  └──────────────┘   └──────────────┘   └────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  apps/api                                                       │
│  ┌──────────────────┐   ┌─────────────────────┐                │
│  │ oauth.controller │──▶│ lark-oauth.service   │                │
│  │ handleLarkCb()   │   │ handleLoginCallback()│                │
│  │   ├─ login       │   │ (now returns tokens) │                │
│  │   └─ upsertCA()  │   └─────────────────────┘                │
│  └──────────────────┘                                           │
│          │                                                      │
│          ▼                                                      │
│  ┌────────────────────────┐   ┌──────────────────────┐         │
│  │ connected-account.svc  │   │   prisma.service.ts  │         │
│  │ upsert()  (new method) │   │   datasourceUrl      │         │
│  └────────────────────────┘   │   error listener     │         │
│                               └──────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. `apps/web/src/lib/user-utils.ts` (New File)

A small utility module exporting a single pure function for email classification.

```typescript
/**
 * Returns true if the email is a synthetic placeholder generated
 * during Lark user creation (e.g., lark_abc123@slopshield.local).
 */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  return /@slopshield\.local$/.test(email);
}
```

### 2. Sidebar Changes (`apps/web/src/components/layout/sidebar.tsx`)

Import `isSyntheticEmail` and apply it when computing display values:

```typescript
import { isSyntheticEmail } from "@/lib/user-utils";

// Inside component:
const hasSyntheticEmail = isSyntheticEmail(user?.email);
const displayName = user?.name || (hasSyntheticEmail ? "User" : user?.email || "User");
const displayEmail = hasSyntheticEmail ? "" : (user?.email || "");
```

The initials derivation remains based on `displayName`.

### 3. Profile Page Changes (`apps/web/src/app/profile/page.tsx`)

Import `isSyntheticEmail` and render a dash placeholder when the email is synthetic:

```typescript
import { isSyntheticEmail } from "@/lib/user-utils";

// In the account info section:
const emailDisplay = isSyntheticEmail(user?.email) ? "—" : user?.email;
```

### 4. `LarkOAuthService.handleLoginCallback` Enhancement

Extend the return type to include tokens so the controller can create a ConnectedAccount:

```typescript
interface LarkLoginResult {
  larkUserId: string;
  email?: string;
  name: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt?: Date;
}

async handleLoginCallback(
  code: string,
  state: string,
): Promise<LarkLoginResult> {
  // ... existing state validation ...
  const appAccessToken = await this.getAppAccessToken();
  const tokenResponse = await this.exchangeCodeForTokens(code, appAccessToken);
  const userInfo = await this.fetchUserInfo(tokenResponse.access_token);

  return {
    larkUserId: userInfo.open_id,
    email: userInfo.email,
    name: userInfo.name,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    tokenExpiresAt: tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000)
      : undefined,
  };
}
```

### 5. `ConnectedAccountService.upsert` (New Method)

An upsert method that creates or updates a ConnectedAccount for a given user+provider:

```typescript
export interface UpsertConnectedAccountInput {
  userId: string;
  provider: string;
  providerAccountId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  displayName: string;
}

async upsert(data: UpsertConnectedAccountInput) {
  const encryptedAccessToken = encrypt(data.accessToken);
  const encryptedRefreshToken = data.refreshToken
    ? encrypt(data.refreshToken)
    : null;

  return this.prisma.connectedAccount.upsert({
    where: {
      userId_provider: { userId: data.userId, provider: data.provider },
    },
    update: {
      providerAccountId: data.providerAccountId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: data.tokenExpiresAt,
      displayName: data.displayName,
      status: 'connected',
    },
    create: {
      userId: data.userId,
      provider: data.provider,
      providerAccountId: data.providerAccountId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: data.tokenExpiresAt,
      displayName: data.displayName,
    },
  });
}
```

### 6. `OAuthController.handleLarkCallback` Update

After a successful login, attempt to upsert the ConnectedAccount. Failures are caught and logged — they must not block the authentication redirect:

```typescript
// Login flow
try {
  const identity = await this.larkOAuthService.handleLoginCallback(code, state);
  const user = await this.authService.findOrCreateLarkUser(identity);
  const tokens = await this.authService.loginWithUser(user);

  // Best-effort: auto-create ConnectedAccount so profile shows "Connected"
  try {
    await this.connectedAccountService.upsert({
      userId: user.id,
      provider: 'lark',
      providerAccountId: identity.larkUserId,
      accessToken: identity.accessToken,
      refreshToken: identity.refreshToken,
      tokenExpiresAt: identity.tokenExpiresAt,
      displayName: identity.name,
    });
  } catch (caError) {
    // Log but don't block login
    this.logger.warn(`Failed to auto-create Lark ConnectedAccount: ${caError}`);
  }

  res.redirect(
    `${frontendUrl}/auth/lark/callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`,
  );
  return;
} catch {
  // Not a login-mode state — try settings connect flow
}
```

### 7. `PrismaService` Connection Resilience

Update the constructor to pass `datasourceUrl` and configure appropriate pool settings:

```typescript
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasourceUrl: process.env.DATABASE_URL,
      log: [
        { emit: "event", level: "query" },
        { emit: "stdout", level: "info" },
        { emit: "stdout", level: "warn" },
        { emit: "stdout", level: "error" },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    this.logger.log("Connecting to PostgreSQL via Prisma…");

    // Log connection errors for observability (Neon drops idle connections)
    this.$on('error' as never, (event: unknown) => {
      this.logger.warn(`Prisma connection event: ${JSON.stringify(event)}`);
    });

    try {
      await this.$connect();
      this.logger.log("PostgreSQL connection established.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to connect to PostgreSQL. Verify DATABASE_URL includes ?pgbouncer=true&connect_timeout=15&pool_timeout=15&connection_limit=5. Cause: ${message}`,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log("Disconnecting from PostgreSQL…");
    await this.$disconnect();
    this.logger.log("PostgreSQL connection closed.");
  }
}
```

**Required DATABASE_URL format for Neon:**
```
postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?pgbouncer=true&connect_timeout=15&pool_timeout=15&connection_limit=5
```

The connection parameters are set in the URL (Render env var), not in Prisma constructor options, because Prisma passes URL query params directly to the underlying pg driver through pgbouncer.

## Data Models

No schema changes required. The existing `ConnectedAccount` model already has all needed fields:

```prisma
model ConnectedAccount {
  id                String    @id @default(cuid())
  userId            String
  provider          String
  providerAccountId String
  accessToken       String
  refreshToken      String?
  tokenExpiresAt    DateTime?
  displayName       String
  status            String    @default("connected")
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  user              User      @relation(fields: [userId], references: [id])

  @@unique([userId, provider])
}
```

## Interfaces

### `isSyntheticEmail` (Pure Function)

| Parameter | Type | Description |
|-----------|------|-------------|
| `email` | `string \| null \| undefined` | The email to check |
| **Returns** | `boolean` | `true` if the email is null, undefined, or matches `/@slopshield\.local$/` |

### `ConnectedAccountService.upsert`

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `UpsertConnectedAccountInput` | userId, provider, providerAccountId, tokens, displayName |
| **Returns** | `Promise<ConnectedAccount>` | The created or updated record |

### `LarkOAuthService.handleLoginCallback` (Updated Return)

| Parameter | Type | Description |
|-----------|------|-------------|
| `code` | `string` | OAuth authorization code |
| `state` | `string` | CSRF state parameter |
| **Returns** | `Promise<LarkLoginResult>` | Identity + tokens (larkUserId, email, name, accessToken, refreshToken, tokenExpiresAt) |

## Error Handling

| Scenario | Strategy |
|----------|----------|
| `isSyntheticEmail` receives null/undefined | Returns `true` (treats missing email same as synthetic) |
| ConnectedAccount upsert fails during login | Caught silently with `logger.warn`; login redirect proceeds normally |
| Prisma connection drop during operation | Logged via `$on('error')` listener; operation may fail but error is observable |
| DATABASE_URL missing pgbouncer params | Error message in `onModuleInit` catch block documents required format |
| Lark API returns no display name | Falls back to `open_id` as the display name |

## Testing Strategy

- **Property-based tests**: `isSyntheticEmail` (pure function over all strings) and `ConnectedAccount.upsert` idempotence (database operation over all user+provider pairs)
- **Example-based unit tests**: Sidebar rendering with synthetic vs. real emails, Profile page display logic
- **Integration tests**: Lark login callback creating ConnectedAccount end-to-end, OAuth controller error resilience when upsert fails
- **Smoke tests**: PrismaService constructor configuration verification (datasourceUrl, pool params documented in error messages)

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Synthetic email detection is consistent with the regex pattern

*For any* string `email`, `isSyntheticEmail(email)` returns `true` if and only if the email is null, undefined, empty, or matches the regex `/@slopshield\.local$/`. For all other strings, it returns `false`.

**Validates: Requirements 1.1, 2.1**

### Property 2: ConnectedAccount upsert idempotence

*For any* user ID and provider pair, calling `upsert` multiple times with different token values SHALL always result in exactly one ConnectedAccount record for that user+provider combination, with the most recently provided token values stored.

**Validates: Requirements 3.3**
