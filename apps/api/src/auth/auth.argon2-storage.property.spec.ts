// Feature: production-grade-system, Property 1: Passwords are stored only as Argon2 hashes, never plaintext
//
// **Validates: Requirements 1.2, 1.3**
//
// For any valid email and password used to register a user, the persisted
// password value is an Argon2 hash that verifies against the original password,
// is never equal to the plaintext, and never appears in any returned user profile.
//
// Strategy: fast-check generates arbitrary (non-empty) password strings and
// email addresses. For each generated pair we invoke AuthService.register(),
// then inspect what was persisted in the database (via the Prisma mock) and
// what was returned to the caller. We assert:
//   1. The stored password starts with "$argon2" (is an Argon2 hash).
//   2. The stored password is NOT equal to the plaintext.
//   3. The stored password verifies against the plaintext using argon2.verify.
//   4. The returned user profile does NOT contain the password field.

import "reflect-metadata";
import fc from "fast-check";
import * as argon2 from "argon2";
import { AuthService } from "./auth.service";

// ---------------------------------------------------------------------------
// Minimal doubles — only the Prisma and Config surfaces AuthService touches
// ---------------------------------------------------------------------------

function createMockPrisma() {
  // Capture whatever `prisma.user.create` is called with so we can inspect the
  // stored password value.
  let capturedCreateData: any = null;

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null), // no existing user
      create: jest.fn().mockImplementation(async (args: any) => {
        capturedCreateData = args.data;
        return {
          id: "test-user-id",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: "rt-id", jti: "jti" }),
    },
    getCapturedCreateData: () => capturedCreateData,
  };

  return prisma;
}

function createMockConfigService() {
  const config: Record<string, string> = {
    NODE_ENV: "test",
    JWT_SECRET: "test-access-secret-for-property-tests",
    REFRESH_SECRET: "test-refresh-secret-for-property-tests",
    JWT_EXPIRATION: "15m",
    REFRESH_EXPIRATION: "7d",
  };

  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      return config[key] ?? defaultValue ?? undefined;
    }),
  };
}

describe("Feature: production-grade-system, Property 1: Passwords are stored only as Argon2 hashes, never plaintext", () => {
  it("for any plaintext password, the stored value is a valid Argon2 hash that is never the plaintext and never returned in the profile", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary non-empty passwords (1–72 chars to stay within
        // Argon2's practical range while covering edge cases).
        fc.string({ minLength: 1, maxLength: 72 }),
        // Generate arbitrary email-like strings
        fc.emailAddress(),
        async (password, email) => {
          const mockPrisma = createMockPrisma();
          const mockConfig = createMockConfigService();

          const authService = new AuthService(
            mockPrisma as any,
            mockConfig as any,
          );

          const result = await authService.register({
            name: "Test User",
            email,
            password,
          });

          // Retrieve what was stored in the database
          const storedData = mockPrisma.getCapturedCreateData();
          const storedPassword = storedData.password;

          // 1. The stored password starts with "$argon2" (it is an Argon2 hash)
          expect(storedPassword).toMatch(/^\$argon2/);

          // 2. The stored password is NOT equal to the plaintext
          expect(storedPassword).not.toBe(password);

          // 3. The stored hash verifies against the original plaintext
          const verifies = await argon2.verify(storedPassword, password);
          expect(verifies).toBe(true);

          // 4. The returned user profile does NOT contain the password field
          expect(result.user).not.toHaveProperty("password");
          // Also ensure neither the stored hash nor plaintext leaks as a value
          const userValues = Object.values(result.user) as unknown[];
          expect(userValues).not.toContain(password);
          expect(userValues).not.toContain(storedPassword);
        },
      ),
      { numRuns: 100 },
    );
  });
});
