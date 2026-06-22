import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Live-mode request behavior for the API client.
 *
 * The config module reads `process.env.NEXT_PUBLIC_API_MODE` /
 * `NEXT_PUBLIC_API_URL` at import time, and `api-client` imports `config` at
 * module scope. To exercise live mode we set the env vars FIRST, then
 * `vi.resetModules()` and dynamically import the client so it picks up a fresh
 * config resolving to live mode with a configured base URL.
 *
 * _Requirements: 3.1, 5.2, 5.3, 5.4, 5.5_
 */

const API_URL = "https://api.example.com";
const TOKEN_KEY = "slopshield_token";

const originalMode = process.env.NEXT_PUBLIC_API_MODE;
const originalUrl = process.env.NEXT_PUBLIC_API_URL;

/** Reset env to live mode and load a fresh copy of the api-client module. */
async function loadLiveClient(): Promise<typeof import("./api-client")> {
  vi.resetModules();
  process.env.NEXT_PUBLIC_API_MODE = "live";
  process.env.NEXT_PUBLIC_API_URL = API_URL;
  return import("./api-client");
}

/** Build a minimal Response-like object for the fetch mock. */
function makeResponse(opts: {
  status: number;
  ok?: boolean;
  json?: unknown;
  statusText?: string;
}): Response {
  const { status, json = null, statusText = "" } = opts;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  return {
    status,
    ok,
    statusText,
    json: () => Promise.resolve(json),
  } as unknown as Response;
}

describe("api-client live mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    if (originalMode === undefined) {
      delete process.env.NEXT_PUBLIC_API_MODE;
    } else {
      process.env.NEXT_PUBLIC_API_MODE = originalMode;
    }
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalUrl;
    }
    vi.resetModules();
  });

  // _Requirements: 5.2_ URL concatenation = apiUrl + path
  it("concatenates apiUrl with the request path", async () => {
    const { apiClient } = await loadLiveClient();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(makeResponse({ status: 200, json: { ok: true } }));

    await apiClient.get("/scans");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${API_URL}/scans`);
  });

  // _Requirements: 5.5_ bearer header attached when token present
  it("attaches the Authorization bearer header when a token is stored", async () => {
    const { apiClient } = await loadLiveClient();
    localStorage.setItem(TOKEN_KEY, "abc123");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(makeResponse({ status: 200, json: {} }));

    await apiClient.get("/auth/me");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer abc123");
  });

  // _Requirements: 5.5_ no Authorization header when token absent
  it("omits the Authorization header when no token is stored", async () => {
    const { apiClient } = await loadLiveClient();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(makeResponse({ status: 200, json: {} }));

    await apiClient.get("/auth/me");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  // _Requirements: 5.3_ 204 resolves to undefined
  it("resolves to undefined for a 204 response", async () => {
    const { apiClient } = await loadLiveClient();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse({ status: 204 }),
    );

    const result = await apiClient.delete("/scans/scan_001");
    expect(result).toBeUndefined();
  });

  // _Requirements: 5.4_ non-OK rejects with ApiError carrying statusCode + message
  it("throws ApiError with statusCode and message on a 400 response", async () => {
    const { apiClient, ApiError } = await loadLiveClient();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse({
        status: 400,
        ok: false,
        json: { message: "Bad request", error: "BadRequest" },
      }),
    );

    await expect(apiClient.get("/scans")).rejects.toMatchObject({
      statusCode: 400,
      message: "Bad request",
      error: "BadRequest",
    });
    await expect(apiClient.get("/scans")).rejects.toBeInstanceOf(ApiError);
  });

  // _Requirements: 5.4_ non-OK 500 also rejects with ApiError
  it("throws ApiError with statusCode and message on a 500 response", async () => {
    const { apiClient, ApiError } = await loadLiveClient();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse({
        status: 500,
        ok: false,
        json: { message: "Server exploded", error: "InternalError" },
      }),
    );

    const error: unknown = await apiClient
      .get("/dashboard/summary")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe("Server exploded");
  });

  // _Requirements: 3.1, 5.2_ Content-Type application/json set for non-FormData POST bodies
  it("sets Content-Type application/json for non-FormData POST bodies", async () => {
    const { apiClient } = await loadLiveClient();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(makeResponse({ status: 200, json: { id: "scan_x" } }));

    await apiClient.post("/scans", { projectId: "proj_1" });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ projectId: "proj_1" }));
  });
});
