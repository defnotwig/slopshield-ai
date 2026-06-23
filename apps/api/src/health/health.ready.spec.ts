import { ReadinessReportSchema } from "@slopshield/shared";

import { HealthController } from "./health.controller";

/**
 * Unit tests for HealthController.ready() — the readiness endpoint that reports
 * each optional Integration as configured/skipped/error without hard-failing.
 *
 * Validates: Requirements 11.6, 11.7
 */
describe("HealthController.ready()", () => {
  let controller: HealthController;

  const ENV_KEYS = [
    "GEMINI_API_KEY",
    "GITHUB_TOKEN",
    "LARK_WEBHOOK_URL",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    controller = new HealthController();
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("conforms to the shared ReadinessReport schema", () => {
    const result = controller.ready();
    expect(ReadinessReportSchema.safeParse(result).success).toBe(true);
  });

  it("reports absent optional integrations as 'skipped' (Req 11.7)", () => {
    expect(controller.ready()).toEqual({
      gemini: "skipped",
      githubToken: "skipped",
      lark: "skipped",
      githubApp: "skipped",
    });
  });

  it("reports configured integrations as 'configured' (Req 11.6)", () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.GITHUB_TOKEN = "gh-token";
    process.env.LARK_WEBHOOK_URL = "https://example.com/hook";

    expect(controller.ready()).toEqual({
      gemini: "configured",
      githubToken: "configured",
      lark: "configured",
      githubApp: "skipped",
    });
  });

  it("treats a blank env value as 'skipped' (not configured)", () => {
    process.env.GEMINI_API_KEY = "   ";

    expect(controller.ready().gemini).toBe("skipped");
  });

  it("does not throw / hard-fail regardless of configuration (Req 11.6)", () => {
    expect(() => controller.ready()).not.toThrow();
  });
});
