/**
 * Unit tests for the scan report page rendering real persisted scan data.
 *
 * Covers Requirement 8.4: when a user opens a scan report, the Web_App renders
 * the report using the persisted scan score, Status_Result, and findings for
 * that scan.
 *
 * Strategy: `useScan` is mocked to return a deterministic persisted scan;
 * `next/navigation` and `recharts` are mocked for jsdom. The test asserts the
 * persisted overall score, status verdict, and finding titles are rendered.
 *
 * _Requirements: 8.4_
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// --- Mocks -----------------------------------------------------------------

const useScanMock = vi.fn();
vi.mock("@/hooks/use-scans", () => ({
  useScan: (id: string) => useScanMock(id),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "scan-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

// Recharts needs layout; stub the gauge's primitives.
vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Empty = () => <div />;
  return {
    ResponsiveContainer: Passthrough,
    RadialBarChart: Passthrough,
    RadialBar: Empty,
    PolarAngleAxis: Empty,
  };
});

import React from "react";
import ScanReportPage from "./page";

const PERSISTED_SCAN = {
  id: "scan-1",
  overallScore: 76,
  statusResult: "needs cleanup",
  status: "completed",
  scanMode: "full",
  aiSummary: "Persisted executive summary text.",
  securityScore: 70,
  maintainabilityScore: 80,
  architectureScore: 75,
  testabilityScore: 65,
  frontendScore: 90,
  backendScore: 60,
  project: { minimumScore: 80 },
  refactorPlan: [],
  recommendedTests: [],
  findings: [
    {
      id: "f1",
      title: "Hardcoded secret detected",
      severity: "critical",
      category: "security",
      blocking: true,
      falsePositive: false,
      filePath: "src/auth.ts",
      lineNumber: 12,
      description: "A credential is committed in source.",
      source: "secret-scanner",
    },
    {
      id: "f2",
      title: "Magic number used",
      severity: "info",
      category: "maintainability",
      blocking: false,
      falsePositive: false,
      filePath: "src/utils.ts",
      lineNumber: 5,
      description: "Replace magic number with a named constant.",
      source: "eslint",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScanReportPage renders persisted scan data (Requirement 8.4)", () => {
  beforeEach(() => {
    useScanMock.mockReturnValue({
      data: PERSISTED_SCAN,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("renders the persisted overall score", () => {
    render(<ScanReportPage />);
    expect(screen.getByText("76")).toBeInTheDocument();
  });

  it("renders the persisted status verdict", () => {
    render(<ScanReportPage />);
    expect(screen.getByText("needs cleanup")).toBeInTheDocument();
  });

  it("renders the persisted AI summary", () => {
    render(<ScanReportPage />);
    expect(
      screen.getByText("Persisted executive summary text."),
    ).toBeInTheDocument();
  });

  it("renders the persisted findings in the findings table", () => {
    render(<ScanReportPage />);
    expect(screen.getByText("Hardcoded secret detected")).toBeInTheDocument();
    expect(screen.getByText("Magic number used")).toBeInTheDocument();
  });

  it("renders a loading state while the scan is loading", () => {
    useScanMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    render(<ScanReportPage />);
    expect(
      screen.getByText(/compiling quality report data/i),
    ).toBeInTheDocument();
  });

  it("renders an error state with a retry affordance on load failure", () => {
    useScanMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(<ScanReportPage />);
    expect(
      screen.getByText(/failed to load audit report/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
