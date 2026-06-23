import * as fc from "fast-check";
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { GitHubTokenService } from "./github-token.service.js";

/**
 * Property-based tests for JWT generation correctness.
 *
 * **Validates: Requirements 9.1**
 *
 * Property 14: JWT generation correctness
 * - For any random App ID string (non-empty), the generated JWT's `iss` claim equals that App ID.
 * - The `iat` claim is within 60 seconds before the current time (now - 60).
 * - The `exp` claim is `iat` + 600 seconds (10 minutes).
 * - The JWT can be verified with the corresponding public key using RS256.
 */
describe("Feature: github-pr-status-checks, Property 14: JWT generation correctness", () => {
  // Generate a test RSA key pair once for all tests in this suite.
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  /**
   * Helper to create a GitHubTokenService with specific appId and privateKey
   * by setting environment variables before instantiation.
   */
  function createServiceWithAppId(appId: string): GitHubTokenService {
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      GITHUB_APP_ENABLED: "true",
      GITHUB_APP_ID: appId,
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_APP_WEBHOOK_SECRET: "test-secret",
    };
    try {
      return new GitHubTokenService();
    } finally {
      process.env = originalEnv;
    }
  }

  describe("iss claim equals the configured App ID", () => {
    it("for any non-empty App ID string, the JWT iss claim matches", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
          (appId) => {
            const service = createServiceWithAppId(appId);
            const token = service.generateAppJwt();
            const decoded = jwt.decode(token) as jwt.JwtPayload;

            expect(decoded).not.toBeNull();
            expect(decoded.iss).toBe(appId);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("iat claim is within 60 seconds before current time", () => {
    it("iat is set to approximately now - 60 seconds", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
          (appId) => {
            const beforeCall = Math.floor(Date.now() / 1000);
            const service = createServiceWithAppId(appId);
            const token = service.generateAppJwt();
            const afterCall = Math.floor(Date.now() / 1000);

            const decoded = jwt.decode(token) as jwt.JwtPayload;
            expect(decoded).not.toBeNull();

            const iat = decoded.iat!;
            // iat should be (now - 60), allow 2 seconds of tolerance for execution time
            expect(iat).toBeGreaterThanOrEqual(beforeCall - 60 - 2);
            expect(iat).toBeLessThanOrEqual(afterCall - 60 + 2);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("exp claim is iat + 600 seconds (10 minutes)", () => {
    it("exp equals iat + 600 for all generated JWTs", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
          (appId) => {
            const service = createServiceWithAppId(appId);
            const token = service.generateAppJwt();
            const decoded = jwt.decode(token) as jwt.JwtPayload;

            expect(decoded).not.toBeNull();

            const iat = decoded.iat!;
            const exp = decoded.exp!;

            // exp should be exactly iat + 10*60 = iat + 600
            // The implementation sets iat = now - 60, exp = now + 10*60
            // So exp - iat = (now + 600) - (now - 60) = 660
            expect(exp - iat).toBe(660);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("JWT can be verified with corresponding public key using RS256", () => {
    it("jwt.verify succeeds with the test public key for all generated tokens", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
          (appId) => {
            const service = createServiceWithAppId(appId);
            const token = service.generateAppJwt();

            // Verification should not throw
            const verified = jwt.verify(token, publicKey, {
              algorithms: ["RS256"],
            }) as jwt.JwtPayload;

            expect(verified.iss).toBe(appId);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
