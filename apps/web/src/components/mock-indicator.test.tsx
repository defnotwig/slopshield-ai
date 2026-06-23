/**
 * Unit tests for the visible mock indicator when mock is permitted in
 * production.
 *
 * Covers Requirement 2.5: where mock mode is permitted in a production
 * environment (via the explicit ALLOW_MOCK_IN_PRODUCTION opt-in resolved by
 * config), the Web_App displays a visible indicator that mock data is in use.
 *
 * The visible indicator is the `MockModeBanner`, which renders iff
 * `config.isMock` is true. config resolves `isMock` to true only when mock
 * mode is actually permitted (and forces it false in live mode / unopted
 * production), so asserting the banner renders for `isMock: true` exercises
 * the "mock permitted in production" path.
 *
 * Strategy: `config.isMock` is resolved at import time, so we mock `@/lib/config`
 * deterministically and dynamically import the banner to bind to the mock.
 *
 * Spec: production-grade-system, task 4.5.
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

describe("Mock indicator: visible when mock is permitted in production (Requirement 2.5)", () => {
  beforeEach(() => {
    vi.resetModules();
    // Simulates a production environment where mock mode has been explicitly
    // permitted via ALLOW_MOCK_IN_PRODUCTION; config exposes isMock: true.
    vi.doMock("@/lib/config", () => ({
      config: {
        apiMode: "mock",
        isMock: true,
        apiUrl: "",
        appName: "SlopShield AI",
      },
    }));
  });

  it("renders the visible mock indicator when mock is permitted", async () => {
    const { MockModeBanner } = await import("./mock-mode-banner");
    render(<MockModeBanner />);

    expect(screen.getByText(DEMO_TEXT)).toBeInTheDocument();
  });

  it("exposes the indicator as a live status region for accessibility", async () => {
    const { MockModeBanner } = await import("./mock-mode-banner");
    render(<MockModeBanner />);

    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});

describe("Mock indicator: hidden when mock is not permitted", () => {
  beforeEach(() => {
    vi.resetModules();
    // Live mode / production without opt-in: config forces isMock false.
    vi.doMock("@/lib/config", () => ({
      config: {
        apiMode: "live",
        isMock: false,
        apiUrl: "https://api.example.com",
        appName: "SlopShield AI",
      },
    }));
  });

  it("renders no indicator when mock is not in use", async () => {
    const { MockModeBanner } = await import("./mock-mode-banner");
    const { container } = render(<MockModeBanner />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(DEMO_TEXT)).toBeNull();
  });
});
