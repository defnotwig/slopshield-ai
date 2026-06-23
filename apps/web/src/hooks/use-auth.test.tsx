import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/**
 * Token persistence and quota-failure handling for the auth hooks.
 *
 * On a successful login/register the Web_App must persist BOTH the access
 * token and the refresh token (Req 1.8). If browser storage rejects the
 * write, the login must be treated as failed — the mutation rejects, the user
 * is NOT navigated to the dashboard, and no partial token is left behind
 * (Req 1.8a).
 *
 * _Requirements: 1.8, 1.8a_
 */

const ACCESS_TOKEN_KEY = "slopshield_token";
const REFRESH_TOKEN_KEY = "slopshield_refresh_token";

// --- Mocks -----------------------------------------------------------------

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const postMock = vi.fn();
const getMock = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    post: (path: string, body?: unknown) => postMock(path, body),
    get: (path: string) => getMock(path),
  },
}));

// Import after mocks are registered.
import { useLogin, useRegister, useLogout } from "./use-auth";

// --- Helpers ---------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const AUTH_RESPONSE = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  user: { id: "u1", email: "dev@example.com" },
};

describe("useLogin / useRegister token persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    pushMock.mockReset();
    postMock.mockReset();
    getMock.mockReset();
    postMock.mockResolvedValue(AUTH_RESPONSE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  // _Requirements: 1.8_ both tokens persisted on login success
  it("persists both the access token and refresh token on login", async () => {
    const { result } = renderHook(() => useLogin(), { wrapper });

    result.current.mutate({ email: "dev@example.com", password: "pw" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe("access-abc");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-xyz");
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });

  // _Requirements: 1.8_ both tokens persisted on register success
  it("persists both the access token and refresh token on register", async () => {
    const { result } = renderHook(() => useRegister(), { wrapper });

    result.current.mutate({ email: "dev@example.com", password: "pw" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe("access-abc");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-xyz");
  });

  // _Requirements: 1.8a_ storage failure => login treated as failed
  it("treats login as failed and does not navigate when storage write throws", async () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    const { result } = renderHook(() => useLogin(), { wrapper });

    result.current.mutate({ email: "dev@example.com", password: "pw" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
    // No partial token should remain.
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  // _Requirements: 1.8a_ storage failure surfaces a descriptive error
  it("surfaces a descriptive error when storage write throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    const { result } = renderHook(() => useLogin(), { wrapper });
    result.current.mutate({ email: "dev@example.com", password: "pw" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toMatch(/storage/i);
  });
});

describe("useLogout token clearing", () => {
  beforeEach(() => {
    localStorage.clear();
    pushMock.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // _Requirements: 1.8_ logout clears both tokens
  it("removes both the access and refresh tokens on logout", async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, "access-abc");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-xyz");
    postMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useLogout(), { wrapper });
    await result.current();

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(pushMock).toHaveBeenCalledWith("/auth/login");
  });

  // _Requirements: 1.5_ logout clears tokens even on network failure
  it("clears tokens and redirects even when the logout API call fails", async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, "access-abc");
    localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-xyz");
    postMock.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useLogout(), { wrapper });
    await result.current();

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(pushMock).toHaveBeenCalledWith("/auth/login");
  });
});
