/**
 * SlopShield AI — Typed HTTP API Client
 *
 * Every method attaches the auth token from localStorage (if present)
 * and throws `ApiError` on non-2xx responses so TanStack Query can
 * handle retries and error states automatically.
 */

const BASE_URL: string =
  typeof window !== "undefined" &&
  (process.env.NEXT_PUBLIC_API_URL ?? "").length > 0
    ? process.env.NEXT_PUBLIC_API_URL!
    : "http://localhost:3001/api";

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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  const isFormData = typeof window !== "undefined" && body instanceof FormData;

  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  if (typeof window !== "undefined") {
    const token = localStorage.getItem("slopshield_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body:
      body !== undefined
        ? isFormData
          ? (body as any)
          : JSON.stringify(body)
        : undefined,
  });

  /* Empty 204 / 201 responses with no body */
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
