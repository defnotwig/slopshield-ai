import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { HealthModule } from "./health.module";

/**
 * Integration test for the health endpoint.
 *
 * Boots a real Nest application importing only {@link HealthModule} and applies
 * the same global prefix (`api`) that `main.ts` sets, then exercises the route
 * over HTTP. Kept hermetic — no Redis/Postgres — by importing just the health
 * module and using Node's global `fetch` (no supertest dependency).
 *
 * Validates: Requirements 1.1, 1.2, 1.4
 */
describe("GET /api/health (integration)", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts: every route is mounted under the `/api` global prefix.
    app.setGlobalPrefix("api");
    await app.init();
    // Listen on an ephemeral port (0) so the test never collides with a
    // running dev server.
    await app.listen(0);

    const url = await app.getUrl();
    // app.getUrl() may report the unspecified address (::1/0.0.0.0); normalize
    // to a loopback host that fetch can reach.
    baseUrl = url.replace("[::1]", "127.0.0.1").replace("0.0.0.0", "127.0.0.1");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns HTTP 200 (Requirements 1.1, 1.2)", async () => {
    const res = await fetch(`${baseUrl}/api/health`);

    expect(res.status).toBe(200);
  });

  it("returns healthy JSON with status, timestamp, and uptime (Requirement 1.2)", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = (await res.json()) as {
      status: string;
      timestamp: string;
      uptime: number;
    };

    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("succeeds with NO Authorization header required (Requirement 1.4)", async () => {
    // Deliberately send no Authorization header — the endpoint must be public.
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Accept: "application/json" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
