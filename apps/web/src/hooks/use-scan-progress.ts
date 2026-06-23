import { useEffect, useState } from "react";
import { subscribeToScan, ScanProgressEvent } from "@/lib/socket";
import { useQueryClient } from "@tanstack/react-query";

export function useScanProgress(scanId: string, initialStatus?: string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ScanProgressEvent | null>(null);
  const [status, setStatus] = useState<string>(initialStatus || "queued");

  useEffect(() => {
    if (initialStatus) {
      setStatus(initialStatus);
    }
  }, [initialStatus]);

  useEffect(() => {
    if (
      !scanId ||
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return;
    }

    // Subscribe to ScanGateway progress events on mount.
    const unsubscribe = subscribeToScan(scanId, (event) => {
      setProgress(event);
      setStatus(event.stage);

      if (event.stage === "completed" || event.stage === "failed") {
        // On scan completion, invalidate the individual scan report plus the
        // cached scan-list and dashboard queries so subsequent views reflect
        // the new scan (Req 8.8). Keys use prefix matching, so the bare key
        // invalidates every variant (e.g. per-projectId) of that query.
        queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
        queryClient.invalidateQueries({ queryKey: ["scans"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard-trends"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard-top-issues"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard-standards"] });
      }
    });

    // Unsubscribe (and leave the scan room / remove socket listener) on unmount.
    return () => {
      unsubscribe();
    };
  }, [scanId, status, queryClient]);

  return {
    progress,
    status,
  };
}
