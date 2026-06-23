// Feature: production-grade-system, Property 1: Passwords are stored only as Argon2 hashes, never plaintext
//
// Property 1: Passwords are stored only as Argon2 hashes, never plaintext.
// Validates: Requirements 1.2, 1.3
//
// For any valid email and password used to register a user, the persisted
// password value is an Argon2 hash that:
//   (a) verifies against the original plaintext password (argon2.verify),
//   (b) is never equal to the plaintext, and
//   (c) never appears in any returned user profile (register/login/getProfile).
//
// Strategy: fast-check generates valid (email, password) pairs. Each pair is
// registered through the REAL AuthService backed by a deterministic in-memory
// Prisma fake (mirroring apps/api/src/auth/auth.int.spec.ts). We then inspect
// what was persisted into the fake user store and every user profile the
// service hands back, asserting the three sub-properties above.

import "reflect-metadata";
import fc from "fast-check";
import * as argon2 from "argon2";
import type { ConfigService } from "@nestjs/config";

import { AuthService } from "./auth.service";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * Deterministic in-memory Prisma fake exposing only the methods AuthService
 * touches: `user.{findUnique,create}` and `refreshToken.{create,findUnique,
 * updateMany}`. The persisted user rows are kept on `users` so the test can
 * assert what the password column actually stored.
 */
function buildPrismaFake(): {
  prisma: Partial<PrismaService>;
  users: Array<Record<string, unknown>>;
} {
  const users: Array<Record<string, unknown>> = [];
  const refreshTokens: Array<Record<string, unknown>> = [];
  let userSeq = 0;

  const prisma: Partial<PrismaService> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: {
      findUnique: async ({
        where,
      }: {
        where: { email?: string; id?: string };
      }) => {
        if (where.email !== undefined) {
          return users.find((u) => u.email === where.email) ?? null;
        }
        if (where.id !== undefined) {
          return users.find((u) => u.id === where.id) ?? null;
        }
        return null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `user_${userSeq++}`,
          larkUserId: null,
          ...data,
        };
        users.push(created);
        return created;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshToken: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `rt_${refreshTokens.length}`,
          revokedAt: null,
          ...data,
        };
        refreshTokens.push(created);
        return created;
      },
      findUnique: async ({ where }: { where: { jti?: string } }) =>
        refreshTokens.find((t) => t.jti === where.jti) ?? null,
      updateMany: async () => ({ count: 0 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };

  return { prisma, users };
}

/** Minimal ConfigService stub returning a dev fallback for any unset key. */
function buildConfigStub(): ConfigService {
  const values: Record<string, string> = {
    NODE_ENV: "test",
    JWT_SECRET: ["prop", "test", "jwt", "secret", "0123456789"].join("_"),
    REFRESH_SECRET: ["prop", "test", "refresh", "secret", "0123456789"].join(
      "_",
    ),
  };
  return {
    get: <T>(key: string, defaultValue?: T): T =>
      (values[key] as unknown as T) ?? (defaultValue as T),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Recursively asserts the plaintext password never appears as any string value
 * (or substring) anywhere in a returned profile object.
 */
function containsPlaintext(value: unknown, plaintext: string): boolean {
  if (typeof value === "string") {
    return value.includes(plaintext);
  }
  if (Array.isArray(value)) {
    return value.some((v) => containsPlaintext(v, plaintext));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) =>
      containsPlaintext(v, plaintext),
    );
  }
  return false;
}

describe("AuthService — Property 1: Passwords are stored only as Argon2 hashes, never plaintext", () => {
  // Generators constrained to the valid input space: non-empty emails and
  // passwords. Passwords include a wide range of characters; emails are kept
  // unique per-registration by the generator + a counter, so register() does
  // not hit the duplicate-email guard.
  //
  // A distinctive, non-alphanumeric `~` marker is woven into every password so
  // the "never appears in any profile" substring check cannot spuriously fail
  // by a short random password coinciding with a profile field (name/email/id,
  // all of which are alphanumeric + a few safe punctuation chars). The password
  // still spans a wide character space, and argon2 hashes/verifies it as-is.
  const passwordArb = fc
    .string({ minLength: 1, maxLength: 64 })
    .map((s) => `~${s}~`);
  const localPartArb = fc
    .string({ minLength: 1, maxLength: 16 })
    .map((s) => s.replace(/[^a-zA-Z0-9._-]/g, "x") || "user");

  it("persists only a verifying Argon2 hash and never leaks plaintext", async () => {
    let counter = 0;

    await fc.assert(
      fc.asyncProperty(
        localPartArb,
        passwordArb,
        async (localPart, password) => {
          const { prisma, users } = buildPrismaFake();
          const service = new AuthService(
            prisma as PrismaService,
            buildConfigStub(),
          );

          const email = `${localPart}+${counter++}@example.com`;
          const registerResult = await service.register({
            name: "Test User",
            email,
            password,
          });

          // The single persisted user row for this registration.
          const persisted = users.find((u) => u.email === email);
          expect(persisted).toBeDefined();
          const storedPassword = persisted?.password as string;

          // (a) The stored value is an Argon2 hash that verifies against the
          //     original plaintext.
          expect(typeof storedPassword).toBe("string");
          expect(storedPassword.startsWith("$argon2")).toBe(true);
          expect(await argon2.verify(storedPassword, password)).toBe(true);

          // (b) The stored value is never equal to the plaintext.
          expect(storedPassword).not.toBe(password);

          // (c) The plaintext (and the stored hash) never appears in any
          //     returned profile: register, login, or getProfile.
          const loginResult = await service.login({ email, password });
          const profileResult = await service.getProfile(
            persisted?.id as string,
          );

          for (const result of [registerResult, loginResult]) {
            expect(result.user.password).toBeUndefined();
            expect(containsPlaintext(result.user, password)).toBe(false);
          }
          expect((profileResult as { password?: unknown }).password).toBe(
            undefined,
          );
          expect(containsPlaintext(profileResult, password)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
