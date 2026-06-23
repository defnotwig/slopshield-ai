import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./config";

/**
 * The config module reads process.env.NEXT_PUBLIC_API_MODE at module-import
 * time. To table-test different env values we reset the module registry and
 * dynamically re-import the module after mutating process.env in each case.
 */
async function loadConfigWith(
  apiMode: string | undefined,
): Promise<typeof import("./config")> {
  vi.resetModules();
  if (apiMode === undefined) {
    delete process.env.NEXT_PUBLIC_API_MODE;
  } else {
    process.env.NEXT_PUBLIC_API_MODE = apiMode;
  }
  return import("./config");
}

describe("config mode resolution", () => {
  const originalMode = process.env.NEXT_PUBLIC_API_MODE;

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.NEXT_PUBLIC_API_MODE;
    } else {
      process.env.NEXT_PUBLIC_API_MODE = originalMode;
    }
    vi.resetModules();
  });

  // _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  const cases: Array<{
    name: string;
    input: string | undefined;
    expectedMode: "mock" | "live";
    expectedIsMock: boolean;
  }> = [
    // 1.1 unset -> mock
    {
      name: "undefined",
      input: undefined,
      expectedMode: "mock",
      expectedIsMock: true,
    },
    // 1.3 empty string is not "live" -> mock
    {
      name: "empty string",
      input: "",
      expectedMode: "mock",
      expectedIsMock: true,
    },
    // 1.3 explicit "mock" -> mock
    {
      name: '"mock"',
      input: "mock",
      expectedMode: "mock",
      expectedIsMock: true,
    },
    // 1.2 case-insensitive "live" -> live
    {
      name: '"LIVE"',
      input: "LIVE",
      expectedMode: "live",
      expectedIsMock: false,
    },
    // 1.2 trimmed " live " -> live
    {
      name: '" live "',
      input: " live ",
      expectedMode: "live",
      expectedIsMock: false,
    },
    // 1.3 garbage -> mock
    {
      name: "garbage",
      input: "banana",
      expectedMode: "mock",
      expectedIsMock: true,
    },
  ];

  for (const { name, input, expectedMode, expectedIsMock } of cases) {
    it(`resolves ${name} to apiMode="${expectedMode}" and isMock=${expectedIsMock}`, async () => {
      const { config } = await loadConfigWith(input);
      expect(config.apiMode).toBe(expectedMode);
      expect(config.isMock).toBe(expectedIsMock);
    });
  }
});

describe("assertLiveConfig live guard", () => {
  function makeConfig(overrides: Partial<AppConfig>): AppConfig {
    return {
      apiMode: "mock",
      isMock: true,
      apiUrl: "",
      appName: "SlopShield AI",
      showMockIndicator: false,
      ...overrides,
    };
  }

  // _Requirements: 5.1_ throws only for live + empty URL
  it("throws when apiMode is live and apiUrl is empty", async () => {
    const { assertLiveConfig } = await import("./config");
    const cfg = makeConfig({ apiMode: "live", isMock: false, apiUrl: "" });
    expect(() => assertLiveConfig(cfg)).toThrow();
  });

  // _Requirements: 5.1_ silent for live + non-empty URL
  it("does not throw when apiMode is live and apiUrl is non-empty", async () => {
    const { assertLiveConfig } = await import("./config");
    const cfg = makeConfig({
      apiMode: "live",
      isMock: false,
      apiUrl: "https://api.example.com",
    });
    expect(() => assertLiveConfig(cfg)).not.toThrow();
  });

  // _Requirements: 5.1_ silent for mock regardless of url
  it("does not throw in mock mode even with an empty apiUrl", async () => {
    const { assertLiveConfig } = await import("./config");
    const cfg = makeConfig({ apiMode: "mock", isMock: true, apiUrl: "" });
    expect(() => assertLiveConfig(cfg)).not.toThrow();
  });

  it("does not throw in mock mode with a non-empty apiUrl", async () => {
    const { assertLiveConfig } = await import("./config");
    const cfg = makeConfig({
      apiMode: "mock",
      isMock: true,
      apiUrl: "https://api.example.com",
    });
    expect(() => assertLiveConfig(cfg)).not.toThrow();
  });
});
