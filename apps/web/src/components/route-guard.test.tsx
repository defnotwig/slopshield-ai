/**
 * Tests for the protected-route redirect guard.
 *
 * Covers Requirement 1.13: an unauthenticated user navigating to a protected
 * Web_App route is redirected to the login route. Public auth routes and the
 * mock/demo mode remain unguarded.
 *
 * Strategy: `config.isMock` and `next/navigation` are resolved at import time,
 * so each suite mocks `@/lib/config` and `next/navigation` deterministically
 * and dynamically imports the guard so it binds to the mocked modules.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const replaceMock = vi.fn();
let currentPathname = "/dashboard";

const TOKEN_KEY = "slopshield_token";
const PROTECTED_TEXT = "protected-content";

function mockNavigation() {
  vi.doMock("next/navigation", () => ({
    usePathname: () => currentPathname,
    useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  }));
}

function mockConfig(isMock: boolean) {
  vi.doMock("@/lib/config", () => ({
    config: {
      apiMode: isMock ? "mock" : "live",
      isMock,
      apiUrl: isMock ? "" : "https://api.example.com",
      appName: "SlopShield AI",
    },
  }));
}

afterEach(() => {
  cleanup();
  vi.doUnmock("@/lib/config");
  vi.doUnmock("next/navigation");
  vi.resetModules();
  replaceMock.mockReset();
  localStorage.clear();
  currentPathname = "/dashboard";
});

describe("RouteGuard: live mode protected routes (Requirement 1.13)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockConfig(false);
    mockNavigation();
  });

  it("redirects an unauthenticated user to the login route", async () => {
    currentPathname = "/dashboard";
    localStorage.removeItem(TOKEN_KEY);

    const { RouteGuard } = await import("./route-guard");
    render(
      <RouteGuard>
        <div>{PROTECTED_TEXT}</div>
      </RouteGuard>,
    );

    expect(replaceMock).toHaveBeenCalledWith("/auth/login");
    expect(screen.queryByText(PROTECTED_TEXT)).toBeNull();
  });

  it("renders protected content for an authenticated user", async () => {
    currentPathname = "/dashboard";
    localStorage.setItem(TOKEN_KEY, "a-valid-token");

    const { RouteGuard } = await import("./route-guard");
    render(
      <RouteGuard>
        <div>{PROTECTED_TEXT}</div>
      </RouteGuard>,
    );

    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByText(PROTECTED_TEXT)).toBeInTheDocument();
  });

  it("does not redirect on public auth routes even without a token", async () => {
    currentPathname = "/auth/login";
    localStorage.removeItem(TOKEN_KEY);

    const { RouteGuard } = await import("./route-guard");
    render(
      <RouteGuard>
        <div>{PROTECTED_TEXT}</div>
      </RouteGuard>,
    );

    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByText(PROTECTED_TEXT)).toBeInTheDocument();
  });
});

describe("RouteGuard: mock mode is unguarded", () => {
  beforeEach(() => {
    vi.resetModules();
    mockConfig(true);
    mockNavigation();
  });

  it("renders protected content without a token in mock mode", async () => {
    currentPathname = "/dashboard";
    localStorage.removeItem(TOKEN_KEY);

    const { RouteGuard } = await import("./route-guard");
    render(
      <RouteGuard>
        <div>{PROTECTED_TEXT}</div>
      </RouteGuard>,
    );

    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByText(PROTECTED_TEXT)).toBeInTheDocument();
  });
});

describe("isPublicRoute", () => {
  beforeEach(() => {
    vi.resetModules();
    mockConfig(false);
    mockNavigation();
  });

  it("treats /auth routes as public and others as protected", async () => {
    const { isPublicRoute } = await import("./route-guard");
    expect(isPublicRoute("/auth/login")).toBe(true);
    expect(isPublicRoute("/auth/register")).toBe(true);
    expect(isPublicRoute("/dashboard")).toBe(false);
    expect(isPublicRoute("/scans/new")).toBe(false);
  });
});
