import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as argon2 from "argon2";

import { AuthModule } from "./auth.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Integration tests for CORS and authentication.
 *
 * Boots a real Nest application importing {@link AuthModule} (which wires the
 * real {@link AuthController}, {@link AuthService}, and {@link JwtAuthGuard})
 * and applies the SAME app setup as `main.ts`: the `api` global prefix and the
 * exact `enableCors({ origin: CORS_ORIGIN, credentials: true, ... })` config.
 * The route is exercised over HTTP with Node's global `fetch` (matching the
 * existing `health.int.spec.ts` convention — no supertest dependency).
 *
 * `PrismaService` is overridden with a deterministic in-memory fake seeded with
 * a demo user (`alice@example.com` / `password123`, mirroring `prisma/seed.ts`)
 * so the login + protected-route behaviours are verified WITHOUT a live
 * Postgres — no Postgres is reachable in CI/this environment, and the auth
 * logic under test (token issuance + bearer verification) is independent of the
 * persistence backend. CORS is wholly DB-independent.
 *
 * The protected route used is `GET /api/auth/me`, which `AuthController` guards
 * with `@UseGuards(JwtAuthGuard)`.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 */
describe("CORS + authentication (integration)", () => {
  const CORS_ORIGIN = "https://slopshield-web.vercel.app";
  const SEED_EMAIL = "alice@example.com";
  const SEED_PASSWORD = "password123";
  const SEED_USER_ID = "00000000-0000-4000-8000-000000000001";

  let app: INestApplication;
  let baseUrl: string;
  let originalEnv: NodeJS.ProcessEnv;

  // In-memory user store standing in for the Prisma `user` model. Only the
  // methods AuthService actually calls (`findUnique`, `create`) are implemented.
  const buildPrismaFake = (
    users: Array<Record<string, unknown>>,
  ): Partial<PrismaService> => ({
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
        const created = { id: SEED_USER_ID, ...data };
        users.push(created);
        return created;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  beforeAll(async () => {
    originalEnv = process.env;
    // Mirror the deployed config: a fixed CORS origin and a real JWT secret so
    // tokens issued by AuthService verify in JwtAuthGuard.
    process.env = {
      ...originalEnv,
      CORS_ORIGIN,
      // Assembled from parts so no contiguous secret-shaped literal sits in
      // source (avoids secret-scanner false positives); a throwaway test value.
      JWT_SECRET: ["integration", "test", "jwt", "secret", "0123456789"].join(
        "_",
      ),
      JWT_EXPIRATION: "15m",
    };

    const hashedPassword = await argon2.hash(SEED_PASSWORD);
    const seededUsers: Array<Record<string, unknown>> = [
      {
        id: SEED_USER_ID,
        name: "Developer Alice",
        email: SEED_EMAIL,
        password: hashedPassword,
        role: "developer",
        larkUserId: null,
      },
    ];

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(buildPrismaFake(seededUsers))
      .compile();

    app = moduleRef.createNestApplication();

    // ---- Same app setup as main.ts ----
    app.setGlobalPrefix("api");
    app.enableCors({
      origin: CORS_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    });

    await app.init();
    await app.listen(0);

    const url = await app.getUrl();
    baseUrl = url.replace("[::1]", "127.0.0.1").replace("0.0.0.0", "127.0.0.1");
  });

  afterAll(async () => {
    await app?.close();
    process.env = originalEnv;
  });

  // Helper: log in with the seeded demo credentials and return the accessToken.
  const login = async (
    email = SEED_EMAIL,
    password = SEED_PASSWORD,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

  // -------------------------------------------------------------------------
  // Requirement 7.1 — CORS allows the Vercel origin with credentials.
  // -------------------------------------------------------------------------
  it("OPTIONS preflight echoes the configured origin with credentials enabled (Req 7.1)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin: CORS_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });

    // Preflight is handled by the CORS middleware (204/200), not the route.
    expect([200, 204]).toContain(res.status);
    // The configured origin is echoed back (not "*"), which is required when
    // credentials are enabled.
    expect(res.headers.get("access-control-allow-origin")).toBe(CORS_ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  // -------------------------------------------------------------------------
  // Requirement 7.2 — login with seeded creds returns an accessToken.
  // -------------------------------------------------------------------------
  it("POST /api/auth/login with seeded credentials returns an accessToken (Req 7.2)", async () => {
    const res = await login();

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      accessToken?: string;
      refreshToken?: string;
      user?: { email?: string };
    };

    expect(typeof body.accessToken).toBe("string");
    expect((body.accessToken ?? "").length).toBeGreaterThan(0);
    // Sanity: the issued token belongs to the seeded user, sans password.
    expect(body.user?.email).toBe(SEED_EMAIL);
  });

  it("POST /api/auth/login with wrong password is rejected (Req 7.2)", async () => {
    const res = await login(SEED_EMAIL, "wrong-password");
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Requirement 7.4 — protected route without a valid JWT → 401.
  // -------------------------------------------------------------------------
  it("protected route without a bearer token responds 401 (Req 7.4)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    expect(res.status).toBe(401);
  });

  it("protected route with a malformed Authorization header responds 401 (Req 7.4)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: "Token not-a-bearer" },
    });
    expect(res.status).toBe(401);
  });

  it("protected route with an invalid bearer token responds 401 (Req 7.4)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: "Bearer not.a.valid.jwt" },
    });
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Requirement 7.3 — protected route WITH a valid JWT is processed.
  // -------------------------------------------------------------------------
  it("protected route with a valid bearer token is processed (Req 7.3)", async () => {
    const loginRes = await login();
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status).toBe(200);
    const profile = (await res.json()) as {
      email?: string;
      password?: string;
    };
    // The request was processed: the guarded handler returned the user profile.
    expect(profile.email).toBe(SEED_EMAIL);
    // Profile is sanitized — the password hash is never returned.
    expect(profile.password).toBeUndefined();
  });
});
