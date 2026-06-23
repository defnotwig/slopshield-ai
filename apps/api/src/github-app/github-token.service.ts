import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { GitHubAppConfig, loadGitHubAppConfig } from './github-app.config';

/**
 * Manages GitHub App authentication: JWT generation, installation token
 * caching with proactive refresh, and credential validation.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 11.7
 */
@Injectable()
export class GitHubTokenService {
  private readonly logger = new Logger(GitHubTokenService.name);
  private readonly config: GitHubAppConfig;

  /** In-memory cache: installationId → { token, expiresAt } */
  private readonly tokenCache = new Map<number, { token: string; expiresAt: Date }>();

  constructor() {
    this.config = loadGitHubAppConfig();
  }

  /**
   * Generate a JWT signed with the App's private key.
   *
   * Claims:
   * - iss: GitHub App ID
   * - iat: now - 60 seconds (clock drift tolerance)
   * - exp: now + 10 minutes
   *
   * Signed with RS256 algorithm as required by GitHub.
   *
   * Validates: Requirement 9.1
   */
  generateAppJwt(): string {
    if (!this.config.appId || !this.config.privateKey) {
      throw new Error(
        'Cannot generate App JWT: GitHub App credentials are not configured.',
      );
    }

    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: this.config.appId,
      iat: now - 60,
      exp: now + 10 * 60,
    };

    return jwt.sign(payload, this.config.privateKey, { algorithm: 'RS256' });
  }

  /**
   * Get an installation token, serving from cache if valid (>5min until expiry).
   * On cache miss or near-expiry, exchanges JWT for a new token via GitHub API.
   *
   * Validates: Requirement 9.2, 9.5
   *
   * @param installationId - The GitHub App installation ID
   * @returns The installation access token string
   */
  async getInstallationToken(installationId: number): Promise<string> {
    const cached = this.tokenCache.get(installationId);

    if (cached && this.isTokenValid(cached.expiresAt)) {
      return cached.token;
    }

    // Token is missing or near expiry — fetch a fresh one
    const appJwt = this.generateAppJwt();

    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `Failed to get installation token for installation ${installationId}: ` +
          `${response.status} ${response.statusText} - ${errorBody}`,
      );
      throw new Error(
        `GitHub API error ${response.status}: Failed to generate installation token`,
      );
    }

    const data = (await response.json()) as {
      token: string;
      expires_at: string;
    };

    const expiresAt = new Date(data.expires_at);

    // Cache the token
    this.tokenCache.set(installationId, {
      token: data.token,
      expiresAt,
    });

    this.logger.log(
      `Fetched new installation token for installation ${installationId}, ` +
        `expires at ${expiresAt.toISOString()}`,
    );

    return data.token;
  }

  /**
   * Validate that required GitHub App credentials are present.
   *
   * Returns:
   * - `{ status: 'configured' }` — enabled and all credentials present
   * - `{ status: 'skipped' }` — feature is disabled
   * - `{ status: 'error', message }` — enabled but credentials missing
   *
   * Validates: Requirement 9.6, 11.7
   */
  validateCredentials(): { status: 'configured' | 'skipped' | 'error'; message?: string } {
    if (!this.config.enabled) {
      return { status: 'skipped' };
    }

    if (this.config.credentialsConfigured) {
      return { status: 'configured' };
    }

    const missing: string[] = [];
    if (!this.config.appId) missing.push('GITHUB_APP_ID');
    if (!this.config.privateKey) missing.push('GITHUB_APP_PRIVATE_KEY');
    if (!this.config.webhookSecret) missing.push('GITHUB_APP_WEBHOOK_SECRET');

    return {
      status: 'error',
      message: `Missing required credentials: ${missing.join(', ')}`,
    };
  }

  /**
   * Check if a cached token is still valid (more than 5 minutes until expiry).
   */
  private isTokenValid(expiresAt: Date): boolean {
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return expiresAt > fiveMinutesFromNow;
  }
}
