/**
 * Property-based test for single-flight silent refresh in the api-client.
 *
 * Feature: production-grade-system, Property 4: Silent refresh happens at most
 * once per 401.
 *
 * Validates: Requirements 1.9, 1.10
 *
 * For any burst of authenticated live-mode requests that receive an HTTP 401
 * due to an expired Access_Token, the api-client must call `/auth/refresh`
 * exactly once (single-flight). On refresh success it retries each original
 * request once with the new token; on refresh failure it clears stored tokens
 * and redirects to `/auth/login`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

// Force the api-client into live mode with a real base URL so every request
// takes the fetch path (never the in-memory mock short-circuit).
vi.mock("./config", () => {
  const config = {
    apiMode: "live" as const,
    isMock: false,
    apiUrl: "https://api.test",
    appName: "SlopShield AI",
    showMockIndicator: false,
  };
  return { config, assertLiveConfig: () => {} };
});

const ACCESS_TOKEN_KEY = "slopshield_token";
const REFRESH_TOKEN_KEY = "slopshield_refresh_token";

interface Scenario {
  requestCount: number;
  refreshSuccess: boolean;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
}

interface Harness {
  refreshCalls: number;
  assignMock: ReturnType<typeof vi.fn>;
}

/**
 * Install fresh globals (localStorage tokens, window.location, fetch) for one
 * scenario and return handles for assertions. The fetch mock models token
 * expiry directly: a request carrying the expired "old" Access_Token gets a
 * 401, while a request carrying the refreshed "new" token succeeds. The
 * `/auth/refresh` endpoint either issues a new token or fails.
 */
function installHarness(scenario: Scenario): Harness {
  localStorage.clear();
  localStorage.setItem(ACCESS_TOKEN_KEY, "old");
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-token");

  const assignMock = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: "/dashboard", assign: assignMock },
  });

  const harness: Harness = { refreshCalls: 0, assignMock };

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;

      if (url.endsWith("/auth/refresh")) {
        harness.refreshCalls += 1;
        if (scenario.refreshSuccess) {
          return new Response(JSON.stringify({ accessToken: "new" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ message: "invalid refresh" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Original request: only the refreshed "new" token is accepted.
      if (headers["Authorization"] === "Bearer new") {
        return new Response(JSON.stringify({ ok: true, url }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ message: "expired token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return harness;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  requestCount: fc.integer({ min: 1, max: 5 }),
  refreshSuccess: fc.boolean(),
  method: fc.constantFrom("GET", "POST", "PATCH", "DELETE"),
  path: fc.constantFrom("/scans", "/dashboard", "/projects", "/auth/me"),
});

function callClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiClient: any,
  method: Scenario["method"],
  path: string,
): Promise<unknown> {
  switch (method) {
    case "GET":
      return apiClient.get(path);
    case "POST":
      return apiClient.post(path, { sample: true });
    case "PATCH":
      return apiClient.patch(path, { sample: true });
    case "DELETE":
      return apiClient.delete(path);
  }
}

describe("api-client silent refresh (Property 4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("calls /auth/refresh at most once per 401 burst and retries or clears", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        // Fresh module instance => fresh single-flight gate per scenario.
        vi.resetModules();
        const harness = installHarness(scenario);
        const { apiClient, ApiError } = await import("./api-client");

        const requests = Array.from({ length: scenario.requestCount }, () =>
          callClient(apiClient, scenario.method, scenario.path),
        );
        const results = await Promise.allSettled(requests);

        // Single-flight invariant: refresh is attempted exactly once for the
        // burst of concurrent 401s (Req 1.9 "exactly once").
        expect(harness.refreshCalls).toBe(1);

        if (scenario.refreshSuccess) {
          // Each original request is retried once with the new token and
          // ultimately succeeds (Req 1.9).
          for (const r of results) {
            expect(r.status).toBe("fulfilled");
          }
          expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe("new");
          expect(harness.assignMock).not.toHaveBeenCalled();
        } else {
          // On refresh failure, every request fails and the session is
          // cleared with a redirect to login (Req 1.10).
          for (const r of results) {
            expect(r.status).toBe("rejected");
            if (r.status === "rejected") {
              expect(r.reason).toBeInstanceOf(ApiError);
              expect((r.reason as InstanceType<typeof ApiError>).statusCode).toBe(401);
            }
          }
          expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
          expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
          expect(harness.assignMock).toHaveBeenCalledWith("/auth/login");
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
