import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import IORedis from 'ioredis';
import { ConnectedAccountService } from './connected-account.service.js';
import { buildRedisConnection } from '../common/redis.js';

/** Redis key prefix for OAuth state parameters. */
const STATE_KEY_PREFIX = 'oauth:github:state:';

/** State TTL in seconds (10 minutes). */
const STATE_TTL_SECONDS = 600;

/**
 * In-memory fallback store for OAuth state when Redis is not available.
 * Each entry stores the userId and an expiration timestamp.
 */
interface InMemoryStateEntry {
  userId: string;
  expiresAt: number;
}

@Injectable()
export class GitHubOAuthService {
  private readonly logger = new Logger(GitHubOAuthService.name);
  private redis: IORedis | null = null;
  private readonly memoryStore = new Map<string, InMemoryStateEntry>();

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl: string;

  constructor(
    private readonly connectedAccountService: ConnectedAccountService,
  ) {
    this.clientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? '';
    this.clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET ?? '';
    this.callbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL ?? '';

    this.initRedis();
  }

  /**
   * Initialize the Redis connection for state storage.
   * Falls back to in-memory Map if REDIS_URL is not configured.
   */
  private initRedis(): void {
    try {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        this.logger.warn(
          'REDIS_URL not configured — GitHub OAuth state will use in-memory storage (not suitable for multi-instance deployments).',
        );
        return;
      }

      const connectionOptions = buildRedisConnection(redisUrl);
      this.redis = new IORedis(connectionOptions);

      this.redis.on('error', (err: Error) => {
        this.logger.warn(
          `Redis connection error in GitHub OAuth service: ${err.message}. Falling back to in-memory store.`,
        );
      });
    } catch (err) {
      this.logger.warn(
        `Failed to initialize Redis for GitHub OAuth: ${(err as Error).message}. Using in-memory store.`,
      );
      this.redis = null;
    }
  }

  // ---------------------------------------------------------------------------
  // State storage helpers
  // ---------------------------------------------------------------------------

  private async storeState(state: string, userId: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.set(
          `${STATE_KEY_PREFIX}${state}`,
          userId,
          'EX',
          STATE_TTL_SECONDS,
        );
        return;
      } catch (err) {
        this.logger.warn(
          `Redis SET failed for OAuth state: ${(err as Error).message}. Using in-memory fallback.`,
        );
      }
    }

    // In-memory fallback
    this.memoryStore.set(state, {
      userId,
      expiresAt: Date.now() + STATE_TTL_SECONDS * 1000,
    });
  }

  private async retrieveAndDeleteState(
    state: string,
  ): Promise<string | null> {
    if (this.redis) {
      try {
        const key = `${STATE_KEY_PREFIX}${state}`;
        const userId = await this.redis.get(key);
        if (userId) {
          await this.redis.del(key);
        }
        return userId;
      } catch (err) {
        this.logger.warn(
          `Redis GET failed for OAuth state: ${(err as Error).message}. Checking in-memory fallback.`,
        );
      }
    }

    // In-memory fallback
    const entry = this.memoryStore.get(state);
    if (!entry) return null;
    this.memoryStore.delete(state);

    if (Date.now() > entry.expiresAt) return null;
    return entry.userId;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Build the GitHub OAuth authorization URL for the given user.
   * Generates a random state parameter and stores it for CSRF verification.
   */
  async getAuthorizationUrl(userId: string): Promise<string> {
    const state = randomBytes(16).toString('hex');
    await this.storeState(state, userId);

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope: 'repo read:user',
      state,
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Handle the OAuth callback from GitHub.
   * Validates state, exchanges code for token, fetches profile, creates account.
   */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ userId: string; displayName: string }> {
    // 1. Validate state
    const userId = await this.retrieveAndDeleteState(state);
    if (!userId) {
      throw new BadRequestException(
        'Invalid or expired OAuth state parameter',
      );
    }

    // 2. Exchange code for access token
    const tokenResponse = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
        }),
      },
    );

    if (!tokenResponse.ok) {
      throw new BadRequestException(
        'Failed to exchange authorization code with provider',
      );
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      throw new BadRequestException(
        tokenData.error_description ??
          'Failed to exchange authorization code with provider',
      );
    }

    const accessToken = tokenData.access_token;

    // 3. Fetch GitHub user profile
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!userResponse.ok) {
      throw new BadRequestException(
        'Failed to fetch GitHub user profile',
      );
    }

    const profile = (await userResponse.json()) as {
      id: number;
      login: string;
    };

    // 4. Create Connected_Account
    await this.connectedAccountService.create({
      userId,
      provider: 'github',
      providerAccountId: String(profile.id),
      accessToken,
      displayName: profile.login,
    });

    return { userId, displayName: profile.login };
  }

  /**
   * List GitHub repositories for the connected user.
   * Handles expired/revoked tokens by marking the account disconnected.
   */
  async listRepos(
    userId: string,
  ): Promise<Array<{ id: number; full_name: string; private: boolean; html_url: string }>> {
    const { accessToken } = await this.connectedAccountService.getDecryptedToken(
      userId,
      'github',
    );

    const response = await fetch(
      'https://api.github.com/user/repos?per_page=100&sort=updated',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    );

    if (response.status === 401) {
      await this.connectedAccountService.markDisconnected(userId, 'github');
      throw new UnauthorizedException(
        'GitHub connection expired. Please reconnect.',
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    const repos = (await response.json()) as Array<{
      id: number;
      full_name: string;
      private: boolean;
      html_url: string;
    }>;

    return repos;
  }

  /**
   * Disconnect the GitHub account for the given user.
   */
  async disconnect(userId: string): Promise<void> {
    await this.connectedAccountService.disconnect(userId, 'github');
  }
}
