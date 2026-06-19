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

    const unsubscribe = subscribeToScan(scanId, (event) => {
      setProgress(event);
      setStatus(event.stage);

      if (event.stage === "completed" || event.stage === "failed") {
        // Invalidate scan cache to fetch the full updated report
        queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
        queryClient.invalidateQueries({ queryKey: ["scans"] });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [scanId, status, queryClient]);

  return {
    progress,
    status,
  };
}
