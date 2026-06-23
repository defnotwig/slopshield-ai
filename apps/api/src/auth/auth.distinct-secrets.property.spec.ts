// Feature: production-grade-system, Property 3: Access and refresh tokens use distinct secrets
//
// Property 3: For any user, the issued Access_Token verifies ONLY under
// JWT_SECRET and the Refresh_Token verifies ONLY under REFRESH_SECRET;
// cross-verifying either token with the other secret fails.
//
// Validates: Requirements 1.11
//
// Strategy: fast-check generates arbitrary user credentials. For each generated
// user we drive the REAL AuthService (signing access with JWT_SECRET and
// refresh with REFRESH_SECRET) backed by an in-memory Prisma fake — the same
// fake approach used by auth.int.spec.ts — with DISTINCT JWT_SECRET /
// REFRESH_SECRET configured. We then assert, via jsonwebtoken, that:
//   (a) the access token verifies under JWT_SECRET,
//   (b) the access token FAILS verification under REFRESH_SECRET,
//   (c) the refresh token verifies under REFRESH_SECRET,
//   (d) the refresh token FAILS verification under JWT_SECRET.

import fc from "fast-check";
import * as jwt from "jsonwebtoken";

import { AuthService } from "./auth.service";

// Distinct, throwaway test secrets. Assembled from parts so no contiguous
// secret-shaped literal sits in source (avoids secret-scanner false positives).
const JWT_SECRET = ["prop3", "access", "secret", "aaaaaaaaaa"].join("_");
const REFRESH_SECRET = ["prop3", "refresh", "secret", "bbbbbbbbbb"].join("_");

// Minimal ConfigService stub returning the configured (distinct) secrets and
// short expirations. Mirrors @nestjs/config's get(key, default) contract.
const configStub = {
  get<T = string>(key: string, defaultValue?: T): T {
    const values: Record<string, string> = {
      NODE_ENV: "test",
      JWT_SECRET,
      REFRESH_SECRET,
      JWT_EXPIRATION: "15m",
      REFRESH_EXPIRATION: "7d",
    };
    return (values[key] ?? defaultValue) as T;
  },
};

// In-memory Prisma fake implementing only the methods AuthService calls during
// register: user.findUnique / user.create and refreshToken.create.
function buildPrismaFake() {
  const users: Array<Record<string, unknown>> = [];
  const refreshTokens: Array<Record<string, unknown>> = [];
  let userSeq = 0;
  return {
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
        const created = {
          id: `00000000-0000-4000-8000-${String(userSeq).padStart(12, "0")}`,
          ...data,
        };
        users.push(created);
        return created;
      },
    },
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
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Arbitrary user-registration payloads with unique-ish emails per iteration.
const userPayloadArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 40 }),
  localPart: fc.stringMatching(/^[a-z0-9]{1,12}$/),
  password: fc.string({ minLength: 8, maxLength: 64 }),
  role: fc.constantFrom("developer", "admin", "viewer"),
});

describe("AuthService — Property 3: Access and refresh tokens use distinct secrets", () => {
  it("access verifies only under JWT_SECRET and refresh only under REFRESH_SECRET (cross-verify fails)", async () => {
    // Sanity: the test itself relies on the two secrets being distinct.
    expect(JWT_SECRET).not.toBe(REFRESH_SECRET);

    let counter = 0;

    await fc.assert(
      fc.asyncProperty(userPayloadArb, async (payload) => {
        // Fresh service + store per iteration to keep emails unique/isolated.
        const service = new AuthService(buildPrismaFake(), configStub as never);

        counter += 1;
        const email = `${payload.localPart}${counter}@example.com`;
        const { accessToken, refreshToken } = await service.register({
          name: payload.name,
          email,
          password: payload.password,
          role: payload.role,
        });

        // (a) Access token verifies under JWT_SECRET.
        const accessClaims = jwt.verify(accessToken, JWT_SECRET) as {
          sub?: string;
          role?: string;
        };
        expect(typeof accessClaims.sub).toBe("string");
        expect(accessClaims.role).toBe(payload.role);

        // (b) Access token MUST fail verification under REFRESH_SECRET.
        expect(() => jwt.verify(accessToken, REFRESH_SECRET)).toThrow();

        // (c) Refresh token verifies under REFRESH_SECRET.
        const refreshClaims = jwt.verify(refreshToken, REFRESH_SECRET) as {
          sub?: string;
          jti?: string;
        };
        expect(typeof refreshClaims.sub).toBe("string");
        expect(typeof refreshClaims.jti).toBe("string");

        // (d) Refresh token MUST fail verification under JWT_SECRET.
        expect(() => jwt.verify(refreshToken, JWT_SECRET)).toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
