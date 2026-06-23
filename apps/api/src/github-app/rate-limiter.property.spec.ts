// Feature: github-pr-status-checks, Property 11: Per-installation rate limiting
//
// Validates: Requirements 8.1, 8.2, 8.7
//
// Property 11: Per-installation rate limiting
// - For any sequence of N scan-triggering webhook events from the same
//   installation within the configured time window, the first
//   RATE_LIMIT_PER_INSTALLATION events are allowed and all subsequent events
//   are rejected.
// - Installation lifecycle events (`installation`, `installation_repositories`)
//   are never rate-limited regardless of the current count.
//
// Since the rate limiter is Redis-backed, we test two aspects that do not
// require a live Redis connection:
// 1. `isExempt(eventType)` — pure logic, always returns true for lifecycle
//    event types, false for everything else.
// 2. Fail-open behavior — when Redis is unavailable (null), `checkAllowed`
//    always returns `{ allowed: true }` for any installationId.

import fc from "fast-check";
import { WebhookRateLimiter } from "./webhook-rate-limiter.service";

describe("WebhookRateLimiter — Property 11: Per-installation rate limiting", () => {
  describe("isExempt: lifecycle events are never rate-limited", () => {
    let limiter: WebhookRateLimiter;

    beforeAll(() => {
      // Instantiate without Redis (REDIS_URL not set) — this is fine for
      // testing isExempt which is pure logic.
      const originalRedisUrl = process.env.REDIS_URL;
      delete process.env.REDIS_URL;
      limiter = new WebhookRateLimiter();
      // Restore env to avoid side effects on other tests
      if (originalRedisUrl !== undefined) {
        process.env.REDIS_URL = originalRedisUrl;
      }
    });

    it("returns true for 'installation' event type", () => {
      fc.assert(
        fc.property(fc.constant("installation"), (eventType) => {
          expect(limiter.isExempt(eventType)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("returns true for 'installation_repositories' event type", () => {
      fc.assert(
        fc.property(fc.constant("installation_repositories"), (eventType) => {
          expect(limiter.isExempt(eventType)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("returns false for any non-lifecycle event type", () => {
      // Generate arbitrary strings that are NOT lifecycle event types
      const nonLifecycleEvent = fc
        .string({ minLength: 0, maxLength: 50 })
        .filter(
          (s) => s !== "installation" && s !== "installation_repositories",
        );

      fc.assert(
        fc.property(nonLifecycleEvent, (eventType) => {
          expect(limiter.isExempt(eventType)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it("returns false for 'pull_request' (scan-triggering event)", () => {
      expect(limiter.isExempt("pull_request")).toBe(false);
    });
  });

  describe("fail-open: checkAllowed always allows when Redis is unavailable", () => {
    let limiter: WebhookRateLimiter;

    beforeAll(() => {
      // Ensure no REDIS_URL so Redis remains null (fail-open mode)
      const originalRedisUrl = process.env.REDIS_URL;
      delete process.env.REDIS_URL;
      limiter = new WebhookRateLimiter();
      if (originalRedisUrl !== undefined) {
        process.env.REDIS_URL = originalRedisUrl;
      }
    });

    it("returns { allowed: true } for any installationId when Redis is null", () => {
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 1_000_000 }),
          async (installationId) => {
            const result = await limiter.checkAllowed(installationId);
            expect(result).toEqual({ allowed: true });
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
