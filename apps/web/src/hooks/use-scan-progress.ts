import { useEffect, useState } from "react";
import { subscribeToScan, ScanProgressEvent } from "@/lib/socket";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

/** Terminal scan states that stop both the socket subscription and polling. */
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

/** How often to poll the scan status as a fallback when socket events are missed. */
const POLL_INTERVAL_MS = 3000;

export function useScanProgress(scanId: string, initialStatus?: string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ScanProgressEvent | null>(null);
  const [status, setStatus] = useState<string>(initialStatus || "queued");

  useEffect(() => {
    if (initialStatus) {
      setStatus(initialStatus);
    }
  }, [initialStatus]);

  // Invalidate cached queries once a scan reaches a terminal state, so the
  // report/list/dashboard views reflect the new scan (Req 8.8).
  function invalidateOnTerminal() {
    queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
    queryClient.invalidateQueries({ queryKey: ["scans"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-trends"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-top-issues"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-standards"] });
  }

  useEffect(() => {
    if (!scanId || TERMINAL_STATES.has(status)) {
      return;
    }

    let cancelled = false;

    // 1) Real-time path: subscribe to ScanGateway progress events on mount.
    const unsubscribe = subscribeToScan(scanId, (event) => {
      if (cancelled) return;
      setProgress(event);
      setStatus(event.stage);
      if (event.stage === "completed" || event.stage === "failed") {
        invalidateOnTerminal();
      }
    });

    // 2) Fallback path: poll the scan status from the DB on an interval. This is
    //    the safety net for when Socket.IO events are missed entirely — e.g. the
    //    socket connects after the scan already finished (common on serverless /
    //    cold-started backends), or a WebSocket hiccup drops the event burst.
    //    Without this, the progress page can hang at "queued" until a manual
    //    reload re-fetches the real status. (Root cause of the stuck loader.)
    const poll = setInterval(async () => {
      if (cancelled) return;
      try {
        const scan = await apiClient.get<{ status: string }>(`/scans/${scanId}`);
        if (cancelled || !scan?.status) return;

        // Only advance the status; never regress past a terminal state.
        setStatus((prev) => {
          if (TERMINAL_STATES.has(prev)) return prev;
          return scan.status;
        });

        if (TERMINAL_STATES.has(scan.status)) {
          invalidateOnTerminal();
          clearInterval(poll);
        }
      } catch {
        // Transient fetch errors are ignored; the next tick retries.
      }
    }, POLL_INTERVAL_MS);

    // Unsubscribe and stop polling on unmount or when status becomes terminal.
    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(poll);
    };
  }, [scanId, status, queryClient]);

  return {
    progress,
    status,
  };
}
