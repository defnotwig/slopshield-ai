// Feature: production-grade-system, Property 2: Refresh-token lifecycle is sound
//
// Property 2: Refresh-token lifecycle is sound.
// Validates: Requirements 1.5, 1.6, 1.7
//
// For any user, a freshly issued, non-revoked, non-expired Refresh_Token can be
// exchanged for a new valid Access_Token (Req 1.6), and for any refresh token
// that is invalid, tampered, expired, or revoked — including one revoked by
// logout (Req 1.5) — the refresh endpoint rejects it with HTTP 401 (Req 1.7).
//
// Strategy: fast-check generates distinct users (name/email/password/role). For
// each user the test drives the REAL AuthService (issueTokens via register,
// then refreshToken / logout) against a deterministic in-memory Prisma fake
// that backs both the `user` and `refreshToken` models — mirroring the fake in
// `auth.int.spec.ts`. No live Postgres is required: the lifecycle logic under
// test (jti issuance, store lookup, revocation, expiry) is independent of the
// persistence backend. A separate generator picks one of the rejection
// "corruption modes" (invalid / tampered / expired / revoked-by-logout /
// revoked-directly) so a single property covers the whole rejection surface.

import { UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import fc from "fast-check";

import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";

const JWT_SECRET = ["pgs", "prop2", "access", "secret", "abcdef0123"].join("_");
const REFRESH_SECRET = ["pgs", "prop2", "refresh", "secret", "9876543210"].join(
  "_",
);

interface RefreshTokenRow {
  jti: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  [k: string]: unknown;
}

/**
 * Deterministic in-memory Prisma fake exposing only the methods AuthService
 * actually calls. The backing arrays are returned so the test can simulate
 * store-level expiry / revocation directly.
 */
function buildPrismaFake(): {
  prisma: PrismaService;
  users: Array<Record<string, unknown>>;
  refreshTokens: RefreshTokenRow[];
} {
  const users: Array<Record<string, unknown>> = [];
  const refreshTokens: RefreshTokenRow[] = [];
  let userSeq = 0;

  const prisma = {
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
        userSeq += 1;
        const created = { id: `user_${userSeq}`, ...data };
        users.push(created);
        return created;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshToken: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created: RefreshTokenRow = {
          revokedAt: null,
          ...(data as unknown as RefreshTokenRow),
        };
        refreshTokens.push(created);
        return created;
      },
      findUnique: async ({ where }: { where: { jti?: string } }) =>
        refreshTokens.find((t) => t.jti === where.jti) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { jti?: string; revokedAt?: null };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const t of refreshTokens) {
          if (where.jti !== undefined && t.jti !== where.jti) continue;
          if (where.revokedAt === null && t.revokedAt !== null) continue;
          Object.assign(t, data);
          count += 1;
        }
        return { count };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as PrismaService;

  return { prisma, users, refreshTokens };
}

/** Minimal ConfigService stand-in returning the test secrets / defaults. */
function buildConfig(): import("@nestjs/config").ConfigService {
  const values: Record<string, string> = {
    NODE_ENV: "test",
    JWT_SECRET,
    REFRESH_SECRET,
    JWT_EXPIRATION: "15m",
    REFRESH_EXPIRATION: "7d",
  };
  return {
    get: <T = string>(key: string, defaultValue?: T): T | undefined =>
      (values[key] as unknown as T) ?? defaultValue,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Asserts a thrown error is a 401 UnauthorizedException. */
async function expect401(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toBeInstanceOf(UnauthorizedException);
  try {
    await action();
    throw new Error("expected the refresh to be rejected, but it resolved");
  } catch (err) {
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getStatus()).toBe(401);
  }
}

// Smart generators constrained to the valid input space.
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
  )
  .map(([local, domain]) => `${local}@${domain}.example`);

const userArb = fc.record({
  name: fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,19}$/),
  email: emailArb,
  password: fc.string({ minLength: 8, maxLength: 32 }),
  role: fc.constantFrom("developer", "lead", "admin"),
});

type CorruptionMode =
  | "invalid"
  | "tampered"
  | "expired-in-store"
  | "revoked-by-logout"
  | "revoked-directly";

describe("AuthService — Property 2: Refresh-token lifecycle is sound", () => {
  // -------------------------------------------------------------------------
  // Req 1.6 — a fresh, non-revoked, non-expired refresh token is exchanged for
  // a valid access token (verifiable under JWT_SECRET, bound to the user).
  // -------------------------------------------------------------------------
  it("exchanges a fresh refresh token for a valid access token", async () => {
    await fc.assert(
      fc.asyncProperty(userArb, async (user) => {
        const { prisma } = buildPrismaFake();
        const service = new AuthService(prisma, buildConfig());

        const { refreshToken, user: profile } = await service.register(user);

        const { accessToken } = await service.refreshToken(refreshToken);

        expect(typeof accessToken).toBe("string");
        expect(accessToken.length).toBeGreaterThan(0);

        // The new access token verifies ONLY under JWT_SECRET and is bound to
        // the registered user.
        const decoded = jwt.verify(accessToken, JWT_SECRET) as {
          sub?: string;
          email?: string;
        };
        expect(decoded.sub).toBe(profile.id);
        expect(decoded.email).toBe(user.email);
      }),
      { numRuns: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // Req 1.5 + 1.7 — invalid / tampered / expired / revoked refresh tokens are
  // all rejected with HTTP 401.
  // -------------------------------------------------------------------------
  it("rejects invalid, tampered, expired, and revoked refresh tokens with 401", async () => {
    await fc.assert(
      fc.asyncProperty(
        userArb,
        fc.constantFrom<CorruptionMode>(
          "invalid",
          "tampered",
          "expired-in-store",
          "revoked-by-logout",
          "revoked-directly",
        ),
        fc.string(),
        async (user, mode, garbage) => {
          const { prisma, refreshTokens } = buildPrismaFake();
          const service = new AuthService(prisma, buildConfig());

          const { refreshToken } = await service.register(user);
          const { jti } = jwt.decode(refreshToken) as { jti: string };

          let candidate = refreshToken;

          switch (mode) {
            case "invalid":
              // A non-JWT garbage string that does not equal a real token.
              candidate = `not.a.jwt.${garbage}`;
              break;
            case "tampered": {
              // Flip the final character of the signature segment so the
              // signature no longer verifies.
              const last = refreshToken[refreshToken.length - 1];
              const replacement = last === "A" ? "B" : "A";
              candidate = refreshToken.slice(0, -1) + replacement;
              break;
            }
            case "expired-in-store": {
              // Simulate store-level expiry: the row is past its expiresAt.
              const row = refreshTokens.find((t) => t.jti === jti);
              if (!row) throw new Error("expected a stored refresh token row");
              row.expiresAt = new Date(Date.now() - 60_000);
              break;
            }
            case "revoked-by-logout":
              await service.logout(refreshToken);
              break;
            case "revoked-directly": {
              const row = refreshTokens.find((t) => t.jti === jti);
              if (!row) throw new Error("expected a stored refresh token row");
              row.revokedAt = new Date();
              break;
            }
          }

          await expect401(() => service.refreshToken(candidate));
        },
      ),
      { numRuns: 120 },
    );
  });

  // -------------------------------------------------------------------------
  // Req 1.5 — after logout, the SAME token that previously worked is rejected
  // (explicit before/after assertion complementing the property above).
  // -------------------------------------------------------------------------
  it("revokes a working refresh token on logout so it can no longer be exchanged", async () => {
    await fc.assert(
      fc.asyncProperty(userArb, async (user) => {
        const { prisma } = buildPrismaFake();
        const service = new AuthService(prisma, buildConfig());

        const { refreshToken } = await service.register(user);

        // Works before logout.
        const before = await service.refreshToken(refreshToken);
        expect(typeof before.accessToken).toBe("string");

        // Logout revokes it.
        await service.logout(refreshToken);

        // Rejected after logout.
        await expect401(() => service.refreshToken(refreshToken));
      }),
      { numRuns: 60 },
    );
  });
});
