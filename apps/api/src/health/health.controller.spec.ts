import { ServiceUnavailableException } from "@nestjs/common";

import { HealthController } from "./health.controller";

/**
 * Unit test for HealthController.check().
 *
 * Validates: Requirements 1.3, 12.3, 12.3a
 */
describe("HealthController.check()", () => {
  let controller: HealthController;

  beforeEach(() => {
    // No PrismaService wired: the optional dependency is absent, so the
    // liveness probe has no datastore to fail against and reports healthy.
    controller = new HealthController();
  });

  it('returns a { status: "ok", timestamp, uptime } shape', async () => {
    const result = await controller.check();

    expect(result).toEqual({
      status: "ok",
      timestamp: expect.any(String),
      uptime: expect.any(Number),
    });
  });

  it('reports status exactly "ok"', async () => {
    expect((await controller.check()).status).toBe("ok");
  });

  it("returns an ISO-8601 timestamp string", async () => {
    const { timestamp } = await controller.check();

    // Round-trips through Date and re-serializes to the identical ISO string.
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
    expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
  });

  it("returns a non-negative numeric uptime", async () => {
    const { uptime } = await controller.check();

    expect(typeof uptime).toBe("number");
    expect(Number.isFinite(uptime)).toBe(true);
    expect(uptime).toBeGreaterThanOrEqual(0);
  });

  it("returns 200/healthy when the database round-trips (Req 12.3)", async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = new HealthController(prisma as any);

    await expect(controller.check()).resolves.toMatchObject({ status: "ok" });
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("throws ServiceUnavailable when the database is unreachable (Req 12.3a)", async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = new HealthController(prisma as any);

    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("does not leak the underlying error detail in the unhealthy response", async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432")),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = new HealthController(prisma as any);

    await expect(controller.check()).rejects.toMatchObject({
      response: { status: "error", reason: "database_unreachable" },
    });
  });
});
