/**
 * SlopShield AI — Typed HTTP API Client
 *
 * Public surface (`apiClient.get/post/patch/delete` and `ApiError`) is
 * unchanged so existing TanStack Query hooks need no edits.
 *
 * In mock mode the client short-circuits to the in-memory mock store via
 * `resolveMock` and never touches the network. In live mode it keeps the
 * original `fetch`-based behavior: it asserts a valid config first, reads the
 * base URL from `config.apiUrl`, attaches the bearer token from browser
 * storage when present, treats `204` as `undefined`, and throws `ApiError`
 * on non-OK responses.
 *
 * Session longevity (Req 1.9, 1.10): on a live-mode 401 caused by an expired
 * Access_Token, the client performs a single-flight silent refresh — it calls
 * `/auth/refresh` exactly once (shared across a burst of concurrent 401s),
 * stores the new Access_Token, and retries the original request once. If the
 * refresh fails it clears stored tokens and redirects to `/auth/login`.
 */

import { config, assertLiveConfig } from "./config";
import { resolveMock } from "./mock-resolver";

/** Browser-storage keys for the issued auth tokens (match `use-auth.ts`). */
const ACCESS_TOKEN_KEY = "slopshield_token";
const REFRESH_TOKEN_KEY = "slopshield_refresh_token";

/** Structured error thrown by the API client on non-2xx responses. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly error?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/* ------------------------------------------------------------------ */

/** Mimic network latency so loading skeletons render in demo mode. */
function delay(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBrowser(): boolean {
  return typeof globalThis.window !== "undefined";
}

/** Clear stored tokens and bounce to login (unless already on an auth route). */
function clearTokensAndRedirect(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  if (!globalThis.window.location.pathname.startsWith("/auth/")) {
    globalThis.window.location.assign("/auth/login");
  }
}

/**
 * Single-flight refresh: while a refresh is in progress, concurrent 401s
 * await the same promise instead of issuing additional `/auth/refresh` calls.
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Call `/auth/refresh` at most once per burst. Resolves `true` when a new
 * Access_Token was stored, `false` otherwise. This deliberately uses `fetch`
 * directly (not `request`) so a 401 from the refresh endpoint itself does not
 * recurse back into refresh handling.
 */
function refreshAccessTokenOnce(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async (): Promise<boolean> => {
    if (!isBrowser()) return false;
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${config.apiUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;

      const json = (await res.json().catch(() => null)) as {
        accessToken?: string;
      } | null;
      if (!json?.accessToken) return false;

      localStorage.setItem(ACCESS_TOKEN_KEY, json.accessToken);
      return true;
    } catch {
      return false;
    }
  })();

  // Reset the gate once the in-flight refresh settles so future 401s (after a
  // fresh login) can trigger a new refresh.
  void refreshInFlight.finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/**
 * Decide what to do about a live-mode 401. Returns `true` when the caller
 * should retry the original request (refresh succeeded); otherwise clears the
 * session and returns `false`. Refresh-endpoint 401s and already-retried
 * requests skip the refresh attempt to avoid loops.
 */
async function handle401(path: string, isRetry: boolean): Promise<boolean> {
  if (!isBrowser()) return false;

  const canRefresh = !isRetry && !path.startsWith("/auth/refresh");
  if (canRefresh && (await refreshAccessTokenOnce())) {
    return true;
  }

  clearTokensAndRedirect();
  return false;
}

/* ------------------------------------------------------------------ */

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isRetry = false,
): Promise<T> {
  // ---- Mock mode: never hit the network ----
  if (config.isMock) {
    await delay();
    return resolveMock<T>(method, path, body);
  }

  // ---- Live mode: surface a clear config error before fetching ----
  assertLiveConfig(); // throws if API_URL missing

  const headers: Record<string, string> = {};
  const isFormData = isBrowser() && body instanceof FormData;

  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  if (isBrowser()) {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const serializedBody =
    body === undefined
      ? undefined
      : isFormData
        ? (body as BodyInit)
        : JSON.stringify(body);

  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers,
    body: serializedBody,
  });

  /* Empty 204 responses with no body */
  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    // A live-mode 401 means the stored Access_Token is missing/expired/invalid.
    // Attempt a single silent refresh and retry the original request exactly
    // once; on failure the session is cleared and the user is sent to login.
    if (res.status === 401 && (await handle401(path, isRetry))) {
      return request<T>(method, path, body, true);
    }
    throw new ApiError(
      res.status,
      json?.message ?? res.statusText,
      json?.error ?? undefined,
    );
  }

  return json as T;
}

/* ------------------------------------------------------------------ */

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return request<T>("GET", path);
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>("POST", path, body);
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>("PATCH", path, body);
  },

  delete<T>(path: string): Promise<T> {
    return request<T>("DELETE", path);
  },
};
