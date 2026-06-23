/**
 * Unit tests for the dashboard KPI cards rendering real API values.
 *
 * Covers Requirement 8.3: the Web_App reads dashboard KPI cards, the verdict
 * distribution, the trend line, top-issue bars, and standards bars from the
 * shared dashboard types returned by the API.
 *
 * Strategy: the dashboard data hooks are mocked so the page renders against
 * deterministic API-shaped values; `recharts` is mocked to lightweight DOM so
 * jsdom (which has no layout) can render the chart containers without warnings.
 *
 * _Requirements: 8.3_
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// --- Mocks -----------------------------------------------------------------

const summaryMock = vi.fn();
const trendsMock = vi.fn();
const topIssuesMock = vi.fn();
const standardsMock = vi.fn();

vi.mock("@/hooks/use-dashboard", () => ({
  useDashboardSummary: () => summaryMock(),
  useDashboardTrends: () => trendsMock(),
  useDashboardTopIssues: () => topIssuesMock(),
  useDashboardStandards: () => standardsMock(),
}));

vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({ data: [], isLoading: false }),
}));

// Recharts relies on layout measurement which jsdom does not provide; replace
// the chart primitives with simple passthrough elements.
vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Empty = () => <div />;
  return {
    ResponsiveContainer: Passthrough,
    LineChart: Passthrough,
    BarChart: Passthrough,
    PieChart: Passthrough,
    Pie: Passthrough,
    Line: Empty,
    Bar: Empty,
    Cell: Empty,
    XAxis: Empty,
    YAxis: Empty,
    CartesianGrid: Empty,
    Tooltip: Empty,
  };
});

import React from "react";
import DashboardPage from "./page";

const SUMMARY = {
  totalScans: 42,
  averageScore: 87.6,
  blockedScans: 5,
  passedScans: 30,
  warningScans: 7,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardPage KPI cards (Requirement 8.3)", () => {
  beforeEach(() => {
    summaryMock.mockReturnValue({
      data: SUMMARY,
      isLoading: false,
      refetch: vi.fn(),
    });
    trendsMock.mockReturnValue({
      data: [
        { scanId: "s1", date: "2024-01-01", score: 80 },
        { scanId: "s2", date: "2024-01-02", score: 90 },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });
    topIssuesMock.mockReturnValue({
      data: [{ category: "security", title: "SQL Injection", count: 3 }],
      isLoading: false,
      refetch: vi.fn(),
    });
    standardsMock.mockReturnValue({
      data: [{ standard: "OWASP-A03", count: 4 }],
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  it("renders the total scans KPI from the API summary", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Total Audits Run")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders the average score KPI rounded from the API summary", () => {
    render(<DashboardPage />);
    // 87.6 rounds to 88.
    expect(screen.getByText("88/100")).toBeInTheDocument();
  });

  it("renders the blocked and passed KPIs from the API summary", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Blocked Merges")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Clean Builds")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("shows N/A for the average score when no summary is available", () => {
    summaryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });
});
