/**
 * Integration tests for the mock-mode banner and no-fetch rendering.
 *
 * Covers:
 *  - Requirement 7.1: banner is visible in mock mode.
 *  - Requirement 7.2: banner renders nothing in live mode.
 *  - Requirement 2.1: rendering mock-mode content performs no network I/O
 *    (no `globalThis.fetch` calls).
 *
 * Strategy: `config.isMock` is resolved from env at import time, which makes a
 * React component's behavior awkward to flip per test. Instead we mock the
 * `@/lib/config` module so `config.isMock` is deterministic for each suite,
 * then dynamically import the banner so it binds to the mocked config.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const DEMO_TEXT = "Demo data — backend not connected";

afterEach(() => {
  cleanup();
  vi.doUnmock("@/lib/config");
  vi.resetModules();
});

describe("MockModeBanner: presence in mock mode (Requirement 7.1)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/config", () => ({
      config: {
        apiMode: "mock",
        isMock: true,
        apiUrl: "",
        appName: "SlopShield AI",
      },
    }));
  });

  it("renders the demo-data label when config.isMock is true", async () => {
    const { MockModeBanner } = await import("./mock-mode-banner");
    render(<MockModeBanner />);
    expect(screen.getByText(DEMO_TEXT)).toBeInTheDocument();
  });

  it("renders a visible status region announcing demo mode", async () => {
    const { MockModeBanner } = await import("./mock-mode-banner");
    render(<MockModeBanner />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent(DEMO_TEXT);
  });
});

describe("MockModeBanner: absence in live mode (Requirement 7.2)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/config", () => ({
      config: {
        apiMode: "live",
        isMock: false,
        apiUrl: "https://api.example.com",
        appName: "SlopShield AI",
      },
    }));
  });

  it("renders nothing when config.isMock is false", async () => {
    const { MockModeBanner } = await import("./mock-mode-banner");
    const { container } = render(<MockModeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render the demo-data label in live mode", async () => {
    const { MockModeBanner } = await import("./mock-mode-banner");
    render(<MockModeBanner />);
    expect(screen.queryByText(DEMO_TEXT)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("No-fetch rendering in mock mode (Requirement 2.1)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/config", () => ({
      config: {
        apiMode: "mock",
        isMock: true,
        apiUrl: "",
        appName: "SlopShield AI",
      },
    }));
  });

  it("does not call globalThis.fetch while rendering the banner", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const { MockModeBanner } = await import("./mock-mode-banner");
    render(<MockModeBanner />);

    expect(screen.getByText(DEMO_TEXT)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    fetchSpy.mockRestore();
  });

  it("does not call fetch when rendering a component that reads mock data", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    // A simple consumer that renders directly from the mock data module.
    const { mockScanJobs } = await import("@/lib/mock-data");
    const { MockModeBanner } = await import("./mock-mode-banner");

    function DemoScans() {
      return (
        <div>
          <MockModeBanner />
          <ul>
            {mockScanJobs.map((scan) => (
              <li key={scan.id}>{scan.id}</li>
            ))}
          </ul>
        </div>
      );
    }

    render(<DemoScans />);

    expect(screen.getByText(DEMO_TEXT)).toBeInTheDocument();
    expect(screen.getByText(mockScanJobs[0].id)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    fetchSpy.mockRestore();
  });
});
