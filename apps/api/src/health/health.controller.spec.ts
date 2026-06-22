import { HealthController } from "./health.controller";

/**
 * Unit test for HealthController.check().
 *
 * Validates: Requirements 1.3
 */
describe("HealthController.check()", () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('returns a { status: "ok", timestamp, uptime } shape', () => {
    const result = controller.check();

    expect(result).toEqual({
      status: "ok",
      timestamp: expect.any(String),
      uptime: expect.any(Number),
    });
  });

  it('reports status exactly "ok"', () => {
    expect(controller.check().status).toBe("ok");
  });

  it("returns an ISO-8601 timestamp string", () => {
    const { timestamp } = controller.check();

    // Round-trips through Date and re-serializes to the identical ISO string.
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
    expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
  });

  it("returns a non-negative numeric uptime", () => {
    const { uptime } = controller.check();

    expect(typeof uptime).toBe("number");
    expect(Number.isFinite(uptime)).toBe(true);
    expect(uptime).toBeGreaterThanOrEqual(0);
  });
});
