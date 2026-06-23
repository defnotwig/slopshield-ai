/**
 * Unit tests for the scan-progress hook: cache invalidation on completion and
 * the Socket.IO subscription lifecycle.
 *
 * Covers:
 *  - Requirement 8.8: when a new scan completes, the Web_App invalidates the
 *    cached dashboard and scan-list data so subsequent views reflect the new
 *    scan.
 *  - Requirement 8.9: the Web_App subscribes to scan progress on mount and
 *    unsubscribes on unmount.
 *
 * Strategy: `subscribeToScan` is mocked to capture the registered callback and
 * expose an unsubscribe spy; a real QueryClient is provided and its
 * `invalidateQueries` is spied so we can assert exactly which query keys are
 * invalidated when a completion event arrives.
 *
 * _Requirements: 8.8, 8.9_
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { ScanProgressEvent } from "@/lib/socket";

// --- Mocks -----------------------------------------------------------------

const unsubscribeSpy = vi.fn();
const subscribeToScanMock = vi.fn();

vi.mock("@/lib/socket", () => ({
  subscribeToScan: (
    scanId: string,
    callback: (event: ScanProgressEvent) => void,
  ) => subscribeToScanMock(scanId, callback),
}));

import { useScanProgress } from "./use-scan-progress";

// --- Helpers ---------------------------------------------------------------

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function emitProgress(event: ScanProgressEvent) {
  // The hook passes its handler as the 2nd argument of subscribeToScan.
  const callback = subscribeToScanMock.mock.calls.at(-1)?.[1] as (
    e: ScanProgressEvent,
  ) => void;
  act(() => {
    callback(event);
  });
}

beforeEach(() => {
  queryClient = new QueryClient();
  subscribeToScanMock.mockReset();
  unsubscribeSpy.mockReset();
  subscribeToScanMock.mockReturnValue(unsubscribeSpy);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useScanProgress subscription lifecycle (Requirement 8.9)", () => {
  it("subscribes to the scan on mount", () => {
    renderHook(() => useScanProgress("scan-1", "queued"), { wrapper });
    expect(subscribeToScanMock).toHaveBeenCalledTimes(1);
    expect(subscribeToScanMock.mock.calls[0][0]).toBe("scan-1");
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useScanProgress("scan-1", "queued"), {
      wrapper,
    });
    expect(unsubscribeSpy).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe for an already-terminal scan", () => {
    renderHook(() => useScanProgress("scan-1", "completed"), { wrapper });
    expect(subscribeToScanMock).not.toHaveBeenCalled();
  });

  it("updates status from progress events", () => {
    const { result } = renderHook(() => useScanProgress("scan-1", "queued"), {
      wrapper,
    });
    emitProgress({
      scanId: "scan-1",
      stage: "scanning",
      percentage: 40,
      message: "Scanning",
      isComplete: false,
      isFailed: false,
    });
    expect(result.current.status).toBe("scanning");
  });
});

describe("useScanProgress cache invalidation on completion (Requirement 8.8)", () => {
  it("invalidates the scan, scan-list, and dashboard queries when the scan completes", () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useScanProgress("scan-1", "queued"), { wrapper });

    emitProgress({
      scanId: "scan-1",
      stage: "completed",
      percentage: 100,
      message: "Done",
      isComplete: true,
      isFailed: false,
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (c) => (c[0] as { queryKey: unknown[] }).queryKey[0],
    );

    expect(invalidatedKeys).toContain("scan");
    expect(invalidatedKeys).toContain("scans");
    expect(invalidatedKeys).toContain("dashboard-summary");
    expect(invalidatedKeys).toContain("dashboard-trends");
    expect(invalidatedKeys).toContain("dashboard-top-issues");
    expect(invalidatedKeys).toContain("dashboard-standards");
  });

  it("does not invalidate caches for non-terminal progress events", () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useScanProgress("scan-1", "queued"), { wrapper });

    emitProgress({
      scanId: "scan-1",
      stage: "scanning",
      percentage: 40,
      message: "Scanning",
      isComplete: false,
      isFailed: false,
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
