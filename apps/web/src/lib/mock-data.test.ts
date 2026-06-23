/**
 * Unit tests for `mock-data.ts` — data consistency and determinism.
 *
 * Covers:
 * - Dashboard aggregates are internally consistent with the mock scan / finding
 *   set (Requirements 4.2, 4.3).
 * - All timestamps are FIXED ISO-8601 strings — no runtime clock (Requirement 4.4).
 * - Importing the module with all `NEXT_PUBLIC_*` env vars unset does not throw
 *   (Requirement 6.2).
 */

import { describe, expect, it, afterEach, vi } from "vitest";
import {
  DashboardSummarySchema,
  DashboardTrendPointSchema,
  TopIssueSchema,
  StandardViolationSchema,
} from "@slopshield/shared";
import {
  mockScanJobs,
  mockDashboardSummary,
  mockDashboardTrends,
  mockDashboardTopIssues,
  mockDashboardStandards,
  mockProjects,
} from "./mock-data";

/** Strict ISO-8601 instant, e.g. 2024-01-15T10:30:00.000Z */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** ISO-8601 calendar date, e.g. 2024-01-15 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe("mock-data: scan job coverage (Requirement 4.2)", () => {
  it("provides at least three scan jobs", () => {
    expect(mockScanJobs.length).toBeGreaterThanOrEqual(3);
  });

  it("spans multiple distinct statuses", () => {
    const statuses = new Set(mockScanJobs.map((s) => s.status));
    expect(statuses.size).toBeGreaterThanOrEqual(2);
  });

  it("spans multiple distinct verdicts", () => {
    const verdicts = new Set(
      mockScanJobs
        .map((s) => s.statusResult)
        .filter((v): v is NonNullable<typeof v> => v != null),
    );
    expect(verdicts.size).toBeGreaterThanOrEqual(2);
  });
});

describe("mock-data: dashboard aggregate consistency (Requirements 4.3, 4.2)", () => {
  it("totalScans equals the number of mock scan jobs", () => {
    expect(mockDashboardSummary.totalScans).toBe(mockScanJobs.length);
  });

  it("blockedScans equals the number of scans with statusResult 'blocked'", () => {
    const expectedBlocked = mockScanJobs.filter(
      (s) => s.statusResult === "blocked",
    ).length;
    expect(mockDashboardSummary.blockedScans).toBe(expectedBlocked);
  });

  it("passedScans counts scans with a passed or passed-with-warnings verdict", () => {
    const expectedPassed = mockScanJobs.filter(
      (s) =>
        s.statusResult === "passed" ||
        s.statusResult === "passed-with-warnings",
    ).length;
    expect(mockDashboardSummary.passedScans).toBe(expectedPassed);
  });

  it("warningScans counts scans with a needs-cleanup verdict", () => {
    const expectedWarnings = mockScanJobs.filter(
      (s) => s.statusResult === "needs-cleanup",
    ).length;
    expect(mockDashboardSummary.warningScans).toBe(expectedWarnings);
  });

  it("averageScore is the rounded mean of completed scans with a score", () => {
    const scored = mockScanJobs.filter(
      (s): s is typeof s & { overallScore: number } =>
        typeof s.overallScore === "number",
    );
    const expectedAverage =
      scored.length === 0
        ? 0
        : Math.round(
            scored.reduce((sum, s) => sum + s.overallScore, 0) / scored.length,
          );
    expect(mockDashboardSummary.averageScore).toBe(expectedAverage);
    expect(mockDashboardSummary.averageScore).toBeGreaterThanOrEqual(0);
    expect(mockDashboardSummary.averageScore).toBeLessThanOrEqual(100);
  });
});

describe("mock-data: dashboard payloads conform to shared schemas (Requirement 8.3)", () => {
  it("mockDashboardSummary parses against DashboardSummarySchema", () => {
    expect(() => DashboardSummarySchema.parse(mockDashboardSummary)).not.toThrow();
  });

  it("every trend point parses against DashboardTrendPointSchema", () => {
    for (const point of mockDashboardTrends) {
      expect(() => DashboardTrendPointSchema.parse(point)).not.toThrow();
    }
  });

  it("every top issue parses against TopIssueSchema", () => {
    for (const issue of mockDashboardTopIssues) {
      expect(() => TopIssueSchema.parse(issue)).not.toThrow();
    }
  });

  it("every standard violation parses against StandardViolationSchema", () => {
    for (const violation of mockDashboardStandards) {
      expect(() => StandardViolationSchema.parse(violation)).not.toThrow();
    }
  });
});

describe("mock-data: fixed ISO timestamps / determinism (Requirement 4.4)", () => {
  it("every scan job timestamp is a fixed ISO-8601 instant string", () => {
    for (const scan of mockScanJobs) {
      expect(scan.createdAt).toMatch(ISO_INSTANT_RE);
      expect(scan.updatedAt).toMatch(ISO_INSTANT_RE);
      if (scan.startedAt != null) {
        expect(scan.startedAt).toMatch(ISO_INSTANT_RE);
      }
      if (scan.completedAt != null) {
        expect(scan.completedAt).toMatch(ISO_INSTANT_RE);
      }
    }
  });

  it("every project createdAt is a fixed ISO-8601 instant string", () => {
    for (const project of mockProjects) {
      expect(project.createdAt).toMatch(ISO_INSTANT_RE);
    }
  });

  it("every dashboard trend date is a fixed ISO-8601 date string", () => {
    for (const point of mockDashboardTrends) {
      expect(point.date).toMatch(ISO_DATE_RE);
    }
  });

  it("returns identical timestamps on repeated reads (no runtime clock)", () => {
    const first = mockScanJobs.map((s) => s.createdAt);
    const second = mockScanJobs.map((s) => s.createdAt);
    expect(second).toEqual(first);
  });
});

describe("mock-data: backend-free import (Requirement 6.2)", () => {
  const PUBLIC_ENV_KEYS = [
    "NEXT_PUBLIC_API_MODE",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_APP_NAME",
  ] as const;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("imports without throwing when all NEXT_PUBLIC_* vars are unset", async () => {
    for (const key of PUBLIC_ENV_KEYS) {
      vi.stubEnv(key, "");
      delete (process.env as Record<string, string | undefined>)[key];
    }
    vi.resetModules();

    await expect(import("./mock-data")).resolves.toBeDefined();
  });

  it("exposes the expected exports after a clean re-import", async () => {
    vi.resetModules();
    const mod = await import("./mock-data");
    expect(Array.isArray(mod.mockScanJobs)).toBe(true);
    expect(mod.mockDashboardSummary.totalScans).toBe(mod.mockScanJobs.length);
  });
});
