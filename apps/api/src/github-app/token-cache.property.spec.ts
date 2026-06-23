import "reflect-metadata";
import * as fc from "fast-check";
import { GitHubTokenService } from "./github-token.service.js";

/**
 * Property-based tests for token cache expiry boundary logic.
 *
 * **Validates: Requirements 9.2**
 *
 * Property 15: Token cache respects expiry boundary
 * - For any cached token with expiresAt more than 5 minutes from now,
 *   getInstallationToken returns the cached token without fetching.
 * - For any cached token with expiresAt 5 minutes or less from now,
 *   getInstallationToken fetches a fresh token from the GitHub API.
 * - The boundary is exactly 5 minutes (300,000 ms).
 */

// Mock loadGitHubAppConfig to provide test credentials
jest.mock("./github-app.config.js", () => ({
  loadGitHubAppConfig: () => ({
    enabled: true,
    appId: "12345",
    privateKey: "mock-private-key",
    webhookSecret: "test-secret",
    scanTimeout: 300,
    rateLimitPerInstallation: 60,
    globalConcurrentScans: 10,
    credentialsConfigured: true,
  }),
}));

// Mock jsonwebtoken to avoid needing a real RSA key — this test is about cache logic
jest.mock("jsonwebtoken", () => ({
  sign: () => "mock.jwt.token",
}));

describe("Feature: github-pr-status-checks, Property 15: Token cache respects expiry boundary", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    // Mock global fetch to simulate GitHub API token exchange
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            token: "ghs_freshtoken_" + Math.random().toString(36).slice(2),
            expires_at: new Date(
              Date.now() + 60 * 60 * 1000,
            ).toISOString(), // 1 hour from now
          }),
          text: async () => "",
        }) as unknown as Response,
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe("Cached token returned when >5min until expiry (no fetch)", () => {
    it("for any expiry time more than 5 minutes from now, the cached token is returned without calling fetch", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate an offset in ms representing time MORE than 5 minutes from now
          // Range: 5 minutes + 1ms to 60 minutes (to simulate realistic token lifetimes)
          fc.integer({ min: 5 * 60 * 1000 + 1, max: 60 * 60 * 1000 }),
          // Installation IDs
          fc.integer({ min: 1, max: 100000 }),
          // Random cached token value
          fc.string({ minLength: 10, maxLength: 50 }).map((s) => `ghs_${s}`),
          async (msUntilExpiry, installationId, cachedToken) => {
            const service = new GitHubTokenService();

            // Pre-populate the cache with a token that expires more than 5 minutes from now
            const expiresAt = new Date(Date.now() + msUntilExpiry);
            const cache = (service as any).tokenCache as Map<
              number,
              { token: string; expiresAt: Date }
            >;
            cache.set(installationId, { token: cachedToken, expiresAt });

            // Reset fetch call count
            fetchSpy.mockClear();

            // Call getInstallationToken — should return cached token
            const result = await service.getInstallationToken(installationId);

            // The cached token should be returned
            expect(result).toBe(cachedToken);
            // Fetch should NOT have been called (cache hit)
            expect(fetchSpy).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Fresh fetch triggered when <=5min until expiry", () => {
    it("for any expiry time 5 minutes or less from now, a fresh token is fetched from the GitHub API", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate an offset in ms representing time AT or WITHIN 5 minutes from now
          // Range: already expired (-60 min) to exactly 5 minutes
          fc.integer({ min: -60 * 60 * 1000, max: 5 * 60 * 1000 }),
          // Installation IDs
          fc.integer({ min: 1, max: 100000 }),
          // Random cached token value (that should NOT be returned)
          fc.string({ minLength: 10, maxLength: 50 }).map((s) => `ghs_old_${s}`),
          async (msUntilExpiry, installationId, cachedToken) => {
            const service = new GitHubTokenService();

            // Pre-populate the cache with a token that expires within 5 minutes
            const expiresAt = new Date(Date.now() + msUntilExpiry);
            const cache = (service as any).tokenCache as Map<
              number,
              { token: string; expiresAt: Date }
            >;
            cache.set(installationId, { token: cachedToken, expiresAt });

            // Reset fetch call count
            fetchSpy.mockClear();

            // Call getInstallationToken — should trigger a fresh fetch
            const result = await service.getInstallationToken(installationId);

            // Fetch SHOULD have been called (cache miss due to near-expiry)
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            // The returned token should NOT be the old cached token
            expect(result).not.toBe(cachedToken);
            // The returned token should be the fresh one from the API
            expect(result).toMatch(/^ghs_freshtoken_/);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Boundary is exactly 5 minutes (300,000 ms)", () => {
    it("a token expiring at exactly now + 5 minutes triggers a fresh fetch (boundary is exclusive)", async () => {
      const service = new GitHubTokenService();
      const installationId = 42;
      const cachedToken = "ghs_boundary_test_token";

      // Set expiry at exactly 5 minutes from now
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const cache = (service as any).tokenCache as Map<
        number,
        { token: string; expiresAt: Date }
      >;
      cache.set(installationId, { token: cachedToken, expiresAt });

      fetchSpy.mockClear();

      const result = await service.getInstallationToken(installationId);

      // At exactly 5 minutes, the token is NOT valid (boundary is >5min, not >=5min)
      // So a fresh fetch should be triggered
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result).not.toBe(cachedToken);
    });

    it("a token expiring at now + 5min + 1ms is served from cache (just over boundary)", async () => {
      const service = new GitHubTokenService();
      const installationId = 99;
      const cachedToken = "ghs_just_over_boundary";

      // Set expiry at 5 minutes + 1ms from now
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000 + 1);
      const cache = (service as any).tokenCache as Map<
        number,
        { token: string; expiresAt: Date }
      >;
      cache.set(installationId, { token: cachedToken, expiresAt });

      fetchSpy.mockClear();

      const result = await service.getInstallationToken(installationId);

      // Just over 5 minutes — cache should be used
      expect(result).toBe(cachedToken);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
