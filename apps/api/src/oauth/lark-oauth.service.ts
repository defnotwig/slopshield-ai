import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ConnectedAccountService } from './connected-account.service.js';

/** Shape of a Lark API response envelope. */
interface LarkApiResponse {
  code: number;
  msg?: string;
  data?: Record<string, unknown>;
}

/** Shape of a Lark app access token response. */
interface LarkAppTokenResponse {
  code: number;
  msg?: string;
  app_access_token: string;
}

/** Shape of a Lark token exchange response data field. */
interface LarkTokenData {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

/** Shape of Lark user info response data field. */
interface LarkUserInfoData {
  open_id: string;
  name: string;
}

/**
 * LarkOAuthService implements the OAuth 2.0 authorization code flow with Lark
 * (Larksuite) as the OAuth provider.
 *
 * Responsibilities:
 * - Generate Lark authorization URL with required scopes and CSRF state
 * - Exchange authorization code for access + refresh tokens
 * - Fetch Lark user identity
 * - Handle token refresh when access token expires
 * - Store/delete Connected_Account records via ConnectedAccountService
 */
@Injectable()
export class LarkOAuthService {
  private readonly logger = new Logger(LarkOAuthService.name);

  /**
   * In-memory state store for OAuth CSRF state parameters.
   * Maps state → { userId, expiresAt }.
   * In production with Redis available, this should be replaced with Redis-backed storage.
   */
  private readonly stateStore = new Map<
    string,
    { userId: string; expiresAt: number }
  >();

  /** TTL for OAuth state parameters (10 minutes). */
  private readonly STATE_TTL_MS = 10 * 60 * 1000;

  constructor(
    private readonly connectedAccountService: ConnectedAccountService,
  ) {}

  // -------------------------------------------------------------------------
  // Configuration helpers
  // -------------------------------------------------------------------------

  private get appId(): string {
    return process.env.LARK_OAUTH_APP_ID ?? '';
  }

  private get appSecret(): string {
    return process.env.LARK_OAUTH_APP_SECRET ?? '';
  }

  private get callbackUrl(): string {
    return process.env.LARK_OAUTH_CALLBACK_URL ?? '';
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate the Lark OAuth authorization URL for a given user.
   * Creates a CSRF state parameter stored with a 10-minute TTL.
   */
  getAuthorizationUrl(userId: string): { url: string; state: string } {
    const state = randomBytes(32).toString('hex');

    // Store state with TTL
    this.stateStore.set(state, {
      userId,
      expiresAt: Date.now() + this.STATE_TTL_MS,
    });

    // Clean up expired entries periodically
    this.cleanupExpiredStates();

    const url =
      `https://open.larksuite.com/open-apis/authen/v1/authorize` +
      `?app_id=${this.appId}` +
      `&redirect_uri=${encodeURIComponent(this.callbackUrl)}` +
      `&state=${state}`;

    return { url, state };
  }

  /**
   * Handle the OAuth callback from Lark.
   * Validates state, exchanges code for tokens, fetches user identity,
   * and creates a Connected_Account record.
   */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ userId: string }> {
    // Validate state parameter (CSRF protection)
    const stored = this.stateStore.get(state);
    if (!stored || stored.expiresAt < Date.now()) {
      this.stateStore.delete(state);
      throw new UnauthorizedException(
        'Invalid or expired OAuth state parameter',
      );
    }

    const { userId } = stored;
    this.stateStore.delete(state);

    // Step 1: Get app access token (required for user token exchange)
    const appAccessToken = await this.getAppAccessToken();

    // Step 2: Exchange authorization code for user access + refresh tokens
    const tokenResponse = await this.exchangeCodeForTokens(
      code,
      appAccessToken,
    );

    // Step 3: Fetch user identity using the access token
    const userInfo = await this.fetchUserInfo(tokenResponse.access_token);

    // Step 4: Create Connected_Account record
    await this.connectedAccountService.create({
      userId,
      provider: 'lark',
      providerAccountId: userInfo.open_id,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiresAt: tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : undefined,
      displayName: userInfo.name || userInfo.open_id,
    });

    return { userId };
  }

  /**
   * Attempt to refresh the Lark access token for a given user.
   * On failure, marks the Connected_Account as disconnected.
   */
  async refreshToken(
    userId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokens = await this.connectedAccountService.getDecryptedToken(
      userId,
      'lark',
    );

    if (!tokens.refreshToken) {
      await this.connectedAccountService.markDisconnected(userId, 'lark');
      throw new UnauthorizedException(
        'Lark connection expired. Please reconnect.',
      );
    }

    try {
      const appAccessToken = await this.getAppAccessToken();

      const response = await fetch(
        'https://open.larksuite.com/open-apis/authen/v1/oidc/refresh_access_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${appAccessToken}`,
          },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
          }),
        },
      );

      const data = (await response.json()) as LarkApiResponse;

      if (!response.ok || data.code !== 0) {
        throw new Error(
          `Lark token refresh failed: ${data.msg || response.statusText}`,
        );
      }

      const tokenData = data.data as unknown as LarkTokenData;

      // Update the stored tokens — delete and recreate with new encrypted values
      await this.connectedAccountService.disconnect(userId, 'lark');
      // Re-create with updated tokens (since we need to re-encrypt)
      const userInfo = await this.fetchUserInfo(tokenData.access_token);
      await this.connectedAccountService.create({
        userId,
        provider: 'lark',
        providerAccountId: userInfo.open_id,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : undefined,
        displayName: userInfo.name || userInfo.open_id,
      });

      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to refresh Lark token for user ${userId}: ${error}`,
      );
      await this.connectedAccountService.markDisconnected(userId, 'lark');
      throw new UnauthorizedException(
        'Lark connection expired. Please reconnect.',
      );
    }
  }

  /**
   * Disconnect the user's Lark account.
   * Delegates to ConnectedAccountService.
   */
  async disconnect(userId: string): Promise<void> {
    await this.connectedAccountService.disconnect(userId, 'lark');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Obtain an app access token from Lark.
   * This is required for subsequent API calls (token exchange, user info).
   */
  private async getAppAccessToken(): Promise<string> {
    const response = await fetch(
      'https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      },
    );

    const data = (await response.json()) as LarkAppTokenResponse;

    if (!response.ok || data.code !== 0) {
      throw new Error(
        `Failed to obtain Lark app access token: ${data.msg || response.statusText}`,
      );
    }

    return data.app_access_token;
  }

  /**
   * Exchange an authorization code for user access and refresh tokens.
   */
  private async exchangeCodeForTokens(
    code: string,
    appAccessToken: string,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  }> {
    const response = await fetch(
      'https://open.larksuite.com/open-apis/authen/v1/oidc/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appAccessToken}`,
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
        }),
      },
    );

    const data = (await response.json()) as LarkApiResponse;

    if (!response.ok || data.code !== 0) {
      throw new Error(
        `Failed to exchange authorization code with provider: ${data.msg || response.statusText}`,
      );
    }

    const tokenData = data.data as unknown as LarkTokenData;

    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
    };
  }

  /**
   * Fetch the Lark user identity using an access token.
   */
  private async fetchUserInfo(
    accessToken: string,
  ): Promise<{ open_id: string; name: string }> {
    const response = await fetch(
      'https://open.larksuite.com/open-apis/authen/v1/user_info',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const data = (await response.json()) as LarkApiResponse;

    if (!response.ok || data.code !== 0) {
      throw new Error(
        `Failed to fetch Lark user info: ${data.msg || response.statusText}`,
      );
    }

    const userInfo = data.data as unknown as LarkUserInfoData;

    return {
      open_id: userInfo.open_id,
      name: userInfo.name,
    };
  }

  /**
   * Remove expired state entries from the in-memory store.
   * Called periodically to prevent memory leaks.
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [key, value] of this.stateStore.entries()) {
      if (value.expiresAt < now) {
        this.stateStore.delete(key);
      }
    }
  }
}
