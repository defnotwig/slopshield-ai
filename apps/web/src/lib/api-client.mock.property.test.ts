/**
 * Property-based tests for the API client in mock mode.
 *
 * Property 1: No network in mock mode
 * When `config.isMock` is true, no request path triggers `fetch`. For all
 * `(method, path)`, the client resolves entirely from `resolveMock` and never
 * touches the network.
 *
 * The default test environment is already mock mode: `config.isMock` defaults
 * to `true` because `NEXT_PUBLIC_API_MODE` is unset. We therefore spy on
 * `globalThis.fetch`, drive arbitrary `(method, path)` requests through the
 * real `apiClient`, and assert `fetch` is never called. For happy-path GET
 * requests we additionally assert the returned payload is defined — proving
 * the response came from the mock store.
 *
 * **Validates: Requirements 2.1, 2.2**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import fc from "fast-check";
import { apiClient } from "./api-client";
import { config } from "./config";
import { mockScanJobs, mockProjects } from "./mock-data";

// Substitute real mock ids for `:id` params so happy-path GETs resolve to
// concrete records instead of 404-ing on a missing resource.
const SCAN_ID = mockScanJobs[0].id;
const PROJECT_ID = mockProjects[0].id;

/** The complete set of REST GET paths the existing hooks emit (happy path). */
const HAPPY_GET_PATHS: readonly string[] = [
  "/scans",
  "/scans?page=1&limit=10",
  `/scans/${SCAN_ID}`,
  `/scans/${SCAN_ID}/findings`,
  "/dashboard/summary",
  "/dashboard/trends",
  "/dashboard/top-issues",
  "/dashboard/standards",
  "/projects",
  `/projects/${PROJECT_ID}`,
  "/rules",
  "/auth/me",
  "/users/notifications",
];

type Method = "get" | "post" | "patch" | "delete";
const METHODS: readonly Method[] = ["get", "post", "patch", "delete"];

let fetchSpy: MockInstance;

beforeEach(() => {
  // Spy on fetch and make it reject loudly: any invocation in mock mode is a
  // failure, so we never want a real network call to actually proceed.
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("fetch should never be called in mock mode"));
});

afterEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockRestore();
});

describe("Property 1: No network access in mock mode (api-client)", () => {
  // Sanity guard: the whole property only makes sense in mock mode.
  it("runs in mock mode by default", () => {
    expect(config.isMock).toBe(true);
  });

  // **Validates: Requirements 2.1**
  it("never calls fetch for any (method, path) request", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...METHODS),
        fc.constantFrom(...HAPPY_GET_PATHS),
        async (method, path) => {
          fetchSpy.mockClear();
          // POST/PATCH/DELETE on unmatched routes resolve to undefined no-ops,
          // GETs on happy paths resolve to mock payloads — neither must fetch.
          await apiClient[method](path);
          expect(fetchSpy.mock.calls.length).toBe(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  // **Validates: Requirements 2.2**
  it("returns a defined typed payload for happy-path GET requests without fetching", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...HAPPY_GET_PATHS), async (path) => {
        fetchSpy.mockClear();
        const payload = await apiClient.get(path);
        expect(fetchSpy.mock.calls.length).toBe(0);
        expect(payload).toBeDefined();
        expect(payload).not.toBeNull();
      }),
      { numRuns: 25 },
    );
  });
});
