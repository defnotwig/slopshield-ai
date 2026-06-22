/**
 * Unit tests for `mock-resolver.ts` — routing, pagination, and filtering.
 *
 * Covers:
 * - Each known hook path resolves to a payload of the expected shape
 *   (Requirement 3.2).
 * - `404` ApiError for an unknown GET path (Requirement 3.3).
 * - No-op `undefined` for an unmodeled mutation path (Requirement 3.4).
 * - `/scans` pagination math: at most `limit` rows, correct page/limit/total,
 *   non-overlapping slices (Requirement 3.5).
 * - Param extraction for `/scans/:id` and filtering for `/scans` and
 *   `/scans/:id/findings` (Requirements 3.2, 3.6).
 */

import { describe, expect, it } from "vitest";
import { resolveMock } from "./mock-resolver";
import { ApiError } from "./api-client";
import { mockScanJobs, mockProjects, mockFindingsByScanId } from "./mock-data";
import type { ScanJob, Finding, Rule } from "@slopshield/shared";
import type {
  PaginatedScans,
  DashboardSummary,
  DashboardTrendPoint,
  TopIssue,
  StandardCompliance,
  Project,
  NotificationSettings,
  DemoUser,
} from "./mock-data";

const SCAN_ID = mockScanJobs[0].id;
const PROJECT_ID = mockProjects[0].id;
const SCAN_WITH_FINDINGS = mockScanJobs[1].id; // SCAN_2: high+medium+low findings

describe("mock-resolver: known hook paths resolve to expected shapes (Requirement 3.2)", () => {
  it("GET /scans returns a paginated envelope { data, page, limit, total }", () => {
    const res = resolveMock<PaginatedScans>("GET", "/scans");
    expect(Array.isArray(res.data)).toBe(true);
    expect(typeof res.page).toBe("number");
    expect(typeof res.limit).toBe("number");
    expect(res.total).toBe(mockScanJobs.length);
  });

  it("GET /scans/:id returns the matching ScanJob", () => {
    const res = resolveMock<ScanJob>("GET", `/scans/${SCAN_ID}`);
    expect(res.id).toBe(SCAN_ID);
    expect(res).toEqual(mockScanJobs[0]);
  });

  it("GET /scans/:id/findings returns an array of findings", () => {
    const res = resolveMock<Finding[]>(
      "GET",
      `/scans/${SCAN_WITH_FINDINGS}/findings`,
    );
    expect(Array.isArray(res)).toBe(true);
    expect(res).toEqual(mockFindingsByScanId[SCAN_WITH_FINDINGS]);
  });

  it("GET /dashboard/summary returns a summary object", () => {
    const res = resolveMock<DashboardSummary>("GET", "/dashboard/summary");
    expect(typeof res.totalScans).toBe("number");
    expect(typeof res.averageScore).toBe("number");
    expect(typeof res.scansByVerdict).toBe("object");
  });

  it("GET /dashboard/trends returns an array of trend points", () => {
    const res = resolveMock<DashboardTrendPoint[]>("GET", "/dashboard/trends");
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
    expect(typeof res[0].date).toBe("string");
  });

  it("GET /dashboard/top-issues returns an array of issues", () => {
    const res = resolveMock<TopIssue[]>("GET", "/dashboard/top-issues");
    expect(Array.isArray(res)).toBe(true);
    expect(typeof res[0].title).toBe("string");
  });

  it("GET /dashboard/standards returns an array of standards", () => {
    const res = resolveMock<StandardCompliance[]>(
      "GET",
      "/dashboard/standards",
    );
    expect(Array.isArray(res)).toBe(true);
    expect(typeof res[0].standard).toBe("string");
  });

  it("GET /projects returns an array of projects", () => {
    const res = resolveMock<Project[]>("GET", "/projects");
    expect(Array.isArray(res)).toBe(true);
    expect(res).toEqual(mockProjects);
  });

  it("GET /projects/:id returns the matching project", () => {
    const res = resolveMock<Project>("GET", `/projects/${PROJECT_ID}`);
    expect(res.id).toBe(PROJECT_ID);
    expect(res).toEqual(mockProjects[0]);
  });

  it("GET /rules returns an array of rules", () => {
    const res = resolveMock<Rule[]>("GET", "/rules");
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
  });

  it("GET /auth/me returns a demo user object", () => {
    const res = resolveMock<DemoUser>("GET", "/auth/me");
    expect(typeof res.id).toBe("string");
    expect(typeof res.email).toBe("string");
  });

  it("GET /users/notifications returns a notification settings object", () => {
    const res = resolveMock<NotificationSettings>(
      "GET",
      "/users/notifications",
    );
    expect(typeof res.larkEnabled).toBe("boolean");
    expect(typeof res.emailEnabled).toBe("boolean");
    expect(typeof res.notifyOnBlocked).toBe("boolean");
  });
});

describe("mock-resolver: /scans pagination (Requirement 3.5)", () => {
  it("returns at most `limit` rows with the requested page/limit and full total", () => {
    const res = resolveMock<PaginatedScans>("GET", "/scans?page=1&limit=2");
    expect(res.data.length).toBeLessThanOrEqual(2);
    expect(res.data.length).toBe(Math.min(2, mockScanJobs.length));
    expect(res.page).toBe(1);
    expect(res.limit).toBe(2);
    expect(res.total).toBe(mockScanJobs.length);
  });

  it("page 2 returns the next slice with no overlap from page 1", () => {
    const page1 = resolveMock<PaginatedScans>("GET", "/scans?page=1&limit=2");
    const page2 = resolveMock<PaginatedScans>("GET", "/scans?page=2&limit=2");

    expect(page2.page).toBe(2);
    expect(page2.limit).toBe(2);
    expect(page2.total).toBe(mockScanJobs.length);

    // No overlap between the two pages.
    const ids1 = new Set(page1.data.map((s) => s.id));
    const overlap = page2.data.filter((s) => ids1.has(s.id));
    expect(overlap).toHaveLength(0);

    // Page 2 is the expected slice (rows 2..3).
    expect(page2.data).toEqual(mockScanJobs.slice(2, 4));
  });

  it("defaults to page 1 / limit 10 when no params are given", () => {
    const res = resolveMock<PaginatedScans>("GET", "/scans");
    expect(res.page).toBe(1);
    expect(res.limit).toBe(10);
    expect(res.data.length).toBe(Math.min(10, mockScanJobs.length));
  });
});

describe("mock-resolver: param extraction for /scans/:id (Requirement 3.2)", () => {
  it("returns the scan whose id matches the path param", () => {
    for (const job of mockScanJobs) {
      const res = resolveMock<ScanJob>("GET", `/scans/${job.id}`);
      expect(res.id).toBe(job.id);
    }
  });

  it("throws ApiError 404 for an unknown scan id", () => {
    try {
      resolveMock("GET", "/scans/does-not-exist");
      throw new Error("expected resolveMock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(404);
    }
  });
});

describe("mock-resolver: query filtering (Requirement 3.6)", () => {
  it("/scans?status=completed returns only completed scans", () => {
    const res = resolveMock<PaginatedScans>("GET", "/scans?status=completed");
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((s) => s.status === "completed")).toBe(true);
    expect(res.total).toBe(
      mockScanJobs.filter((s) => s.status === "completed").length,
    );
  });

  it("/scans?projectId=<id> returns only scans for that project", () => {
    const res = resolveMock<PaginatedScans>(
      "GET",
      `/scans?projectId=${PROJECT_ID}`,
    );
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((s) => s.projectId === PROJECT_ID)).toBe(true);
    expect(res.total).toBe(
      mockScanJobs.filter((s) => s.projectId === PROJECT_ID).length,
    );
  });

  it("/scans/:id/findings?severity=<sev> returns only matching findings", () => {
    const severity = "high";
    const res = resolveMock<Finding[]>(
      "GET",
      `/scans/${SCAN_WITH_FINDINGS}/findings?severity=${severity}`,
    );
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((f) => f.severity === severity)).toBe(true);
  });

  it("/scans/:id/findings?category=<cat> returns only matching findings", () => {
    const category = mockFindingsByScanId[SCAN_WITH_FINDINGS][0].category;
    const res = resolveMock<Finding[]>(
      "GET",
      `/scans/${SCAN_WITH_FINDINGS}/findings?category=${category}`,
    );
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((f) => f.category === category)).toBe(true);
  });
});

describe("mock-resolver: unmatched routes (Requirements 3.3, 3.4)", () => {
  it("throws ApiError with statusCode 404 for an unknown GET path", () => {
    try {
      resolveMock("GET", "/unknown");
      throw new Error("expected resolveMock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(404);
    }
  });

  it("returns undefined for a POST to an unmodeled path", () => {
    expect(resolveMock("POST", "/unknown", { foo: "bar" })).toBeUndefined();
  });

  it("returns undefined for a PATCH to an unmodeled path", () => {
    expect(resolveMock("PATCH", "/users/notifications", {})).toBeUndefined();
  });

  it("returns undefined for a DELETE to an unmodeled path", () => {
    expect(resolveMock("DELETE", "/projects/anything")).toBeUndefined();
  });
});
