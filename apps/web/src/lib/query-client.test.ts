/**
 * Unit tests for makeQueryClient retry defaults.
 *
 * Feature: backend-hosting-live-mode
 * Validates: Requirement 9.2 — an API request that fails/times out while the
 * Render service is waking is retried at least once before surfacing an error,
 * using an increasing (capped) backoff so the UI shows a loading state.
 */

import { describe, expect, it } from "vitest";

import { makeQueryClient } from "./query-client";

describe("makeQueryClient: cold-start retry defaults (Requirement 9.2)", () => {
  it("retries failed queries at least once", () => {
    const client = makeQueryClient();
    const queries = client.getDefaultOptions().queries;

    expect(queries).toBeDefined();
    // `retry` is configured as a fixed number; assert it allows >= 1 retry.
    expect(typeof queries?.retry).toBe("number");
    expect(queries?.retry as number).toBeGreaterThanOrEqual(1);
  });

  it("uses a retryDelay that increases with the attempt number", () => {
    const client = makeQueryClient();
    const retryDelay = client.getDefaultOptions().queries?.retryDelay;

    expect(typeof retryDelay).toBe("function");

    // retryDelay signature is (failureCount, error) => number.
    const delayFn = retryDelay as (attempt: number, error: unknown) => number;
    const error = new Error("cold start");

    const delay1 = delayFn(1, error);
    const delay2 = delayFn(2, error);

    expect(delay2).toBeGreaterThan(delay1);
  });

  it("caps the retryDelay at 15000ms for large attempt numbers", () => {
    const client = makeQueryClient();
    const delayFn = client.getDefaultOptions().queries?.retryDelay as (
      attempt: number,
      error: unknown,
    ) => number;
    const error = new Error("cold start");

    // Attempt numbers large enough to exceed the cap should clamp to 15000.
    expect(delayFn(10, error)).toBe(15_000);
    expect(delayFn(50, error)).toBe(15_000);

    // Every delay across a wide range stays within the cap.
    for (let attempt = 0; attempt <= 50; attempt += 1) {
      expect(delayFn(attempt, error)).toBeLessThanOrEqual(15_000);
    }
  });
});
