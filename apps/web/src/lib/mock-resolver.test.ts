/**
 * Unit tests for the mock-resolver unmodeled-mutation warning.
 *
 * Covers Requirement 2.6 (resolves audit finding C2): when the Web_App
 * resolves an unmodeled mutation in Mock_Mode, it emits a console warning
 * identifying the unmodeled operation rather than silently no-op'ing.
 *
 * Spec: production-grade-system, task 4.5.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMock } from "./mock-resolver";
import { ApiError } from "./api-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mock-resolver: unmodeled-mutation warning (Requirement 2.6)", () => {
  it("emits a console.warn identifying an unmodeled mutation and no-ops", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // No DELETE route exists for /scans/:id, so this mutation is unmodeled.
    const result = resolveMock<undefined>("DELETE", "/scans/abc-123");

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    // The warning must identify the unmodeled operation (method + path).
    expect(message).toContain("DELETE");
    expect(message).toContain("/scans/abc-123");
  });

  it("emits a warning for an unmodeled PATCH mutation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveMock<undefined>("PATCH", "/users/profile");

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain("/users/profile");
  });

  it("does NOT warn for a modeled mutation route", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // POST /scans is a modeled route; it should resolve without warning.
    const job = resolveMock<{ status: string }>("POST", "/scans", {
      sourceType: "repository",
      sourceRef: "https://github.com/octocat/Hello-World",
    });

    expect(job).toBeDefined();
    expect(job.status).toBe("queued");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("throws a 404 for an unmodeled GET rather than warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => resolveMock("GET", "/does/not/exist")).toThrow(ApiError);
    // GET gaps surface as 404s, not silent no-op warnings.
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
