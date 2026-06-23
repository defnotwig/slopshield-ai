/**
 * Unit tests for the scan history page rendering real ScanJob records.
 *
 * Covers Requirement 8.7: when a user views scan history, the Web_App displays
 * real ScanJob records (and their stage/verdict transitions).
 *
 * Strategy: `useScans`/`useProjects` are mocked to return deterministic
 * ScanJob records so the table renders against real-shaped data.
 *
 * _Requirements: 8.7_
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// --- Mocks -----------------------------------------------------------------

const useScansMock = vi.fn();
vi.mock("@/hooks/use-scans", () => ({
  useScans: (...args: unknown[]) => useScansMock(...args),
}));

vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({ data: [], isLoading: false }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import React from "react";
import ScansHistoryPage from "./page";

const SCANS = {
  items: [
    {
      id: "scan-aaa",
      project: { name: "Checkout Service" },
      sourceType: "repository",
      overallScore: 92,
      statusResult: "passed",
      status: "completed",
      createdAt: "2024-02-01T10:00:00.000Z",
    },
    {
      id: "scan-bbb",
      project: null,
      sourceType: "upload",
      overallScore: 55,
      statusResult: "blocked",
      status: "completed",
      createdAt: "2024-02-02T11:30:00.000Z",
    },
  ],
  totalPages: 1,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScansHistoryPage renders real ScanJob records (Requirement 8.7)", () => {
  beforeEach(() => {
    useScansMock.mockReturnValue({
      data: SCANS,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("renders the real scan job ids", () => {
    render(<ScansHistoryPage />);
    expect(screen.getByText("scan-aaa")).toBeInTheDocument();
    expect(screen.getByText("scan-bbb")).toBeInTheDocument();
  });

  it("renders the real overall scores and verdicts", () => {
    render(<ScansHistoryPage />);
    expect(screen.getByText("92/100")).toBeInTheDocument();
    expect(screen.getByText("55/100")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });

  it("renders the real project association and source type", () => {
    render(<ScansHistoryPage />);
    expect(screen.getByText("Checkout Service")).toBeInTheDocument();
    expect(screen.getByText("repository")).toBeInTheDocument();
    expect(screen.getByText("upload")).toBeInTheDocument();
  });

  it("renders a loading state while history is loading", () => {
    useScansMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    render(<ScansHistoryPage />);
    expect(screen.getByText(/fetching scan history/i)).toBeInTheDocument();
  });

  it("renders an error state with a retry affordance on failure", () => {
    useScansMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(<ScansHistoryPage />);
    expect(screen.getByText(/failed to load scan history/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders an empty state when there are no scans", () => {
    useScansMock.mockReturnValue({
      data: { items: [], totalPages: 1 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<ScansHistoryPage />);
    expect(
      screen.getByText(/no scan logs match the current filters/i),
    ).toBeInTheDocument();
  });
});
