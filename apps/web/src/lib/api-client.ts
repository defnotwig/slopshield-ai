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
 */

import { config, assertLiveConfig } from "./config";
import { resolveMock } from "./mock-resolver";

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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  // ---- Mock mode: never hit the network ----
  if (config.isMock) {
    await delay();
    return resolveMock<T>(method, path, body);
  }

  // ---- Live mode: surface a clear config error before fetching ----
  assertLiveConfig(); // throws if API_URL missing

  const headers: Record<string, string> = {};
  const isFormData =
    typeof globalThis.window !== "undefined" && body instanceof FormData;

  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  if (typeof globalThis.window !== "undefined") {
    const token = localStorage.getItem("slopshield_token");
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
