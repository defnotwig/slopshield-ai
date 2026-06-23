/**
 * Redis-backed webhook rate limiter for the GitHub App integration.
 *
 * Enforces:
 * - Per-installation sliding window (default 60 scan-triggering events/hour)
 * - Global concurrent scan semaphore (default 10)
 *
 * Fail-open: if Redis is unavailable, the request is allowed through and a
 * warning is logged. This ensures scanner availability is not blocked by
 * Redis outages (graceful degradation per design doc).
 *
 * Installation lifecycle events (`installation`, `installation_repositories`)
 * are always exempt from rate limiting.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { Injectable, Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { GitHubAppConfig, loadGitHubAppConfig } from './github-app.config';
import { buildRedisConnection } from '../common/redis';
import { RateLimitResult } from './types';

/** Event types exempt from rate limiting (installation lifecycle events). */
const EXEMPT_EVENT_TYPES = new Set(['installation', 'installation_repositories']);

/** Redis key prefix for per-installation sliding window sorted sets. */
const INSTALLATION_KEY_PREFIX = 'github:ratelimit:';

/** Redis key for the global concurrent scan counter. */
const GLOBAL_CONCURRENT_KEY = 'github:concurrent_scans';

/** Sliding window duration in milliseconds (1 hour). */
const WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class WebhookRateLimiter {
  private readonly logger = new Logger(WebhookRateLimiter.name);
  private readonly config: GitHubAppConfig;
  private redis: IORedis | null = null;

  constructor() {
    this.config = loadGitHubAppConfig();
    this.initRedis();
  }

  /**
   * Initialize the Redis connection for rate limiting.
   * If REDIS_URL is not available, Redis remains null and the limiter fails open.
   */
  private initRedis(): void {
    try {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        this.logger.warn(
          'REDIS_URL not configured — rate limiter will fail open (all requests allowed).',
        );
        return;
      }

      const connectionOptions = buildRedisConnection(redisUrl);
      this.redis = new IORedis(connectionOptions);

      this.redis.on('error', (err: Error) => {
        this.logger.warn(
          `Redis connection error in rate limiter: ${err.message}. Failing open.`,
        );
      });
    } catch (err) {
      this.logger.warn(
        `Failed to initialize Redis for rate limiter: ${(err as Error).message}. Failing open.`,
      );
      this.redis = null;
    }
  }

  /**
   * Check if a scan-triggering event from the given installation is allowed.
   *
   * Enforces:
   * 1. Per-installation sliding window limit (default 60/hour)
   * 2. Global concurrent scan limit (default 10)
   *
   * Returns `{ allowed: true }` if both checks pass, otherwise returns
   * `{ allowed: false, reason }` indicating which limit was hit.
   *
   * Fails open (allows) if Redis is unavailable.
   */
  async checkAllowed(installationId: number): Promise<RateLimitResult> {
    if (!this.redis) {
      // Fail open when Redis is not available
      return { allowed: true };
    }

    try {
      // 1. Check per-installation sliding window
      const installationAllowed = await this.checkInstallationLimit(installationId);
      if (!installationAllowed) {
        return { allowed: false, reason: 'per-installation' };
      }

      // 2. Check global concurrent scan limit
      const globalAllowed = await this.checkGlobalConcurrentLimit();
      if (!globalAllowed) {
        return { allowed: false, reason: 'global-limit' };
      }

      // Record this event in the sliding window
      await this.recordInstallationEvent(installationId);

      return { allowed: true };
    } catch (err) {
      // Fail open on Redis errors
      this.logger.warn(
        `Rate limiter Redis error for installation ${installationId}: ${(err as Error).message}. Allowing request.`,
      );
      return { allowed: true };
    }
  }

  /**
   * Record that a scan has started (increments global concurrent count).
   * Used to track active scans against the global concurrency limit.
   */
  async recordScanStart(installationId: number): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.incr(GLOBAL_CONCURRENT_KEY);
    } catch (err) {
      this.logger.warn(
        `Failed to record scan start for installation ${installationId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Record that a scan has completed (decrements global concurrent count).
   * Ensures the counter does not go below zero.
   */
  async recordScanEnd(installationId: number): Promise<void> {
    if (!this.redis) return;

    try {
      // Use a Lua script to ensure the counter doesn't go below 0
      const script = `
        local current = tonumber(redis.call('GET', KEYS[1]) or '0')
        if current > 0 then
          return redis.call('DECR', KEYS[1])
        end
        return 0
      `;
      await this.redis.eval(script, 1, GLOBAL_CONCURRENT_KEY);
    } catch (err) {
      this.logger.warn(
        `Failed to record scan end for installation ${installationId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Check if an event type is exempt from rate limiting.
   * Installation lifecycle events are always exempt.
   *
   * Validates: Requirement 8.7
   */
  isExempt(eventType: string): boolean {
    return EXEMPT_EVENT_TYPES.has(eventType);
  }

  /**
   * Check the per-installation sliding window count against the configured limit.
   * Uses a Redis sorted set with timestamps as scores.
   *
   * @returns true if the installation is within its rate limit
   */
  private async checkInstallationLimit(installationId: number): Promise<boolean> {
    const redis = this.redis;
    if (!redis) return true;

    const key = `${INSTALLATION_KEY_PREFIX}${installationId}`;
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Remove expired entries and count remaining in a single pipeline
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    const results = await pipeline.exec();

    const zcardResult = results?.[1];
    if (!zcardResult) return true; // fail open

    const [zcardErr, count] = zcardResult;
    if (zcardErr) throw zcardErr;

    return (count as number) < this.config.rateLimitPerInstallation;
  }

  /**
   * Record a scan-triggering event in the per-installation sliding window.
   * Adds the current timestamp to the sorted set and sets a TTL for automatic
   * cleanup.
   */
  private async recordInstallationEvent(installationId: number): Promise<void> {
    const redis = this.redis;
    if (!redis) return;

    const key = `${INSTALLATION_KEY_PREFIX}${installationId}`;
    const now = Date.now();

    const pipeline = redis.pipeline();
    // Add current timestamp as both score and member (use score for uniqueness with a random suffix)
    pipeline.zadd(key, now.toString(), `${now}:${Math.random().toString(36).slice(2, 8)}`);
    // Set TTL slightly longer than the window to ensure automatic cleanup
    pipeline.expire(key, Math.ceil(WINDOW_MS / 1000) + 60);
    await pipeline.exec();
  }

  /**
   * Check whether the global concurrent scan count is below the configured limit.
   *
   * @returns true if the global concurrency limit has not been reached
   */
  private async checkGlobalConcurrentLimit(): Promise<boolean> {
    const redis = this.redis;
    if (!redis) return true;

    const current = await redis.get(GLOBAL_CONCURRENT_KEY);
    const count = current ? Number.parseInt(current, 10) : 0;
    return count < this.config.globalConcurrentScans;
  }
}
