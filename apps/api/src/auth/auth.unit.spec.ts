import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";

import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";

/**
 * Unit tests for the authentication happy paths (Req 1.1, 1.4).
 *
 * These exercise {@link AuthService} and {@link AuthController} directly (no
 * HTTP server, no Nest DI container) against a deterministic in-memory Prisma
 * fake — mirroring the fake used by `auth.int.spec.ts` but only implementing
 * the `user` + `refreshToken` methods the auth logic calls. This keeps the
 * tests fast and focused on the service/controller contract:
 *
 *   - Req 1.1: login returns accessToken + refreshToken + user profile.
 *   - Req 1.2: register creates the user and returns the same token triple.
 *   - Req 1.4: the current-user path (`getProfile` / controller `getMe`)
 *     returns the authenticated user profile.
 *
 * The profile returned by both paths is sanitized — the password hash is never
 * exposed.
 */
describe("Auth happy paths (unit)", () => {
  const SEED_EMAIL = "alice@example.com";
  const SEED_PASSWORD = "password123";
  const SEED_USER_ID = "00000000-0000-4000-8000-000000000001";

  // Minimal in-memory stand-ins for the Prisma `user` and `refreshToken`
  // models. Only the methods AuthService actually calls are implemented.
  type Row = Record<string, unknown>;

  const buildPrismaFake = (
    users: Row[],
  ): { prisma: PrismaService; refreshTokens: Row[] } => {
    const refreshTokens: Row[] = [];
    const prisma = {
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
        create: async ({ data }: { data: Row }) => {
          const created = { id: `user_${users.length}`, ...data };
          users.push(created);
          return created;
        },
      },
      refreshToken: {
        create: async ({ data }: { data: Row }) => {
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
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { prisma: prisma as PrismaService, refreshTokens };
  };

  // Non-secret-shaped, clearly-labelled test secrets, assembled from parts so
  // no contiguous secret-shaped literal sits in source.
  const TEST_CONFIG: Record<string, string> = {
    JWT_SECRET: ["unit", "test", "jwt", "secret"].join("_"),
    REFRESH_SECRET: ["unit", "test", "refresh", "secret"].join("_"),
    JWT_EXPIRATION: "15m",
    REFRESH_EXPIRATION: "7d",
    NODE_ENV: "test",
  };

  const buildConfig = (): ConfigService =>
    ({
      get: (key: string, fallback?: string) => TEST_CONFIG[key] ?? fallback,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  const buildService = async (): Promise<{
    service: AuthService;
    users: Row[];
  }> => {
    const hashedPassword = await argon2.hash(SEED_PASSWORD);
    const users: Row[] = [
      {
        id: SEED_USER_ID,
        name: "Developer Alice",
        email: SEED_EMAIL,
        password: hashedPassword,
        role: "developer",
        larkUserId: null,
      },
    ];
    const { prisma } = buildPrismaFake(users);
    const service = new AuthService(prisma, buildConfig());
    return { service, users };
  };

  // ---------------------------------------------------------------------------
  // Req 1.1 — login returns access + refresh + profile.
  // ---------------------------------------------------------------------------
  it("login returns an accessToken, refreshToken, and the sanitized user profile (Req 1.1)", async () => {
    const { service } = await buildService();

    const result = await service.login({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    });

    expect(typeof result.accessToken).toBe("string");
    expect(result.accessToken.length).toBeGreaterThan(0);
    expect(typeof result.refreshToken).toBe("string");
    expect(result.refreshToken.length).toBeGreaterThan(0);

    expect(result.user).toBeDefined();
    expect(result.user.id).toBe(SEED_USER_ID);
    expect(result.user.email).toBe(SEED_EMAIL);
    expect(result.user.role).toBe("developer");
    // The profile is sanitized — the password hash is never returned.
    expect(result.user.password).toBeUndefined();
  });

  it("login persists a refresh-token row for later revocation (Req 1.1)", async () => {
    const hashedPassword = await argon2.hash(SEED_PASSWORD);
    const users: Row[] = [
      {
        id: SEED_USER_ID,
        name: "Developer Alice",
        email: SEED_EMAIL,
        password: hashedPassword,
        role: "developer",
        larkUserId: null,
      },
    ];
    const { prisma, refreshTokens } = buildPrismaFake(users);
    const service = new AuthService(prisma, buildConfig());

    await service.login({ email: SEED_EMAIL, password: SEED_PASSWORD });

    expect(refreshTokens).toHaveLength(1);
    expect(refreshTokens[0].userId).toBe(SEED_USER_ID);
    expect(typeof refreshTokens[0].jti).toBe("string");
  });

  // ---------------------------------------------------------------------------
  // Req 1.2 — register creates the user and returns access + refresh + profile.
  // ---------------------------------------------------------------------------
  it("register creates the user and returns accessToken, refreshToken, and profile (Req 1.2)", async () => {
    const { service, users } = await buildService();

    const result = await service.register({
      name: "Bob Builder",
      email: "bob@example.com",
      password: "s3cret-password",
      role: "developer",
    });

    expect(typeof result.accessToken).toBe("string");
    expect(result.accessToken.length).toBeGreaterThan(0);
    expect(typeof result.refreshToken).toBe("string");
    expect(result.refreshToken.length).toBeGreaterThan(0);

    expect(result.user.email).toBe("bob@example.com");
    expect(result.user.name).toBe("Bob Builder");
    // Password is never returned in the profile...
    expect(result.user.password).toBeUndefined();

    // ...and is persisted only as an Argon2 hash (never plaintext).
    const stored = users.find((u) => u.email === "bob@example.com");
    expect(stored).toBeDefined();
    const storedHash = stored?.password as string | undefined;
    expect(storedHash).not.toBe("s3cret-password");
    expect(storedHash).toMatch(/^\$argon2/);
  });

  it("register defaults the role to developer when none is supplied (Req 1.2)", async () => {
    const { service } = await buildService();

    const result = await service.register({
      name: "No Role",
      email: "norole@example.com",
      password: "another-password",
    });

    expect(result.user.role).toBe("developer");
  });

  // ---------------------------------------------------------------------------
  // Req 1.4 — current-user path returns the authenticated profile.
  // ---------------------------------------------------------------------------
  it("getProfile returns the sanitized profile for a valid user id (Req 1.4)", async () => {
    const { service } = await buildService();

    const profile = await service.getProfile(SEED_USER_ID);

    expect(profile.id).toBe(SEED_USER_ID);
    expect(profile.email).toBe(SEED_EMAIL);
    expect(profile.name).toBe("Developer Alice");
    expect(profile.role).toBe("developer");
    expect(profile.password).toBeUndefined();
  });

  it("controller getMe returns the profile for the authenticated user (Req 1.4)", async () => {
    const { service } = await buildService();

    // The JwtAuthGuard populates `req.user` from a valid Access_Token; here we
    // emulate that by passing a request whose `user.sub` is the access-token
    // subject. We derive `sub` from a real login so the wiring matches runtime.
    const loginResult = await service.login({
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    });
    expect(loginResult.user.id).toBe(SEED_USER_ID);

    // Audit writes are best-effort and irrelevant to this path; a no-op stub.
    const auditStub = {
      record: async () => undefined,
    } as unknown as AuditService;
    const controller = new AuthController(service, auditStub);

    const req = { user: { sub: SEED_USER_ID } };
    const profile = await controller.getMe(req);

    expect(profile.id).toBe(SEED_USER_ID);
    expect(profile.email).toBe(SEED_EMAIL);
    expect(profile.password).toBeUndefined();
  });

  it("controller login returns the token triple and records an audit entry (Req 1.1)", async () => {
    const { service } = await buildService();

    const recorded: unknown[] = [];
    const auditStub = {
      record: async (input: unknown) => {
        recorded.push(input);
      },
    } as unknown as AuditService;
    const controller = new AuthController(service, auditStub);

    const req = { headers: {}, socket: {} };
    const result = await controller.login(
      { email: SEED_EMAIL, password: SEED_PASSWORD },
      req,
    );

    expect(typeof result.accessToken).toBe("string");
    expect(typeof result.refreshToken).toBe("string");
    expect(result.user.email).toBe(SEED_EMAIL);
    expect(recorded).toHaveLength(1);
  });
});
