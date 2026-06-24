"use client";

import React, { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useScan } from "@/hooks/use-scans";
import { useScanProgress } from "@/hooks/use-scan-progress";
import { ScanTimeline } from "@/components/scan-timeline";
import { ArrowRight, FileText, Loader2, AlertCircle, RefreshCw } from "lucide-react";

export default function ScanProgressPage() {
  const router = useRouter();
  const params = useParams();
  const scanId = params.id as string;

  const { data: scan, isLoading, isError, refetch } = useScan(scanId);
  const { progress, status } = useScanProgress(scanId, scan?.status);

  const failureMessage =
    scan?.failureReason && scan.failureReason.trim().length > 0
      ? scan.failureReason
      : "The scan could not be completed. Please try again.";

  // If the scan was already completed before loading this page, redirect directly to report
  useEffect(() => {
    if (scan && scan.status === "completed") {
      router.push(`/scans/${scanId}/report`);
    }
  }, [scan, scanId, router]);

  // If socket progress completes, redirect after a short delay
  useEffect(() => {
    if (status === "completed") {
      const timer = setTimeout(() => {
        router.push(`/scans/${scanId}/report`);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [status, scanId, router]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="w-8 h-8 text-ring animate-spin" />
        <p className="text-sm font-mono text-muted-foreground">
          Initializing scan channel context...
        </p>
      </div>
    );
  }

  if (isError || !scan) {
    return (
      <div className="max-w-md mx-auto py-24 text-center space-y-4">
        <div className="p-4 bg-red-500/10 text-red-500 rounded-full w-fit mx-auto border border-red-500/20">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold">Failed to load scan job</h3>
        <p className="text-xs text-muted-foreground">
          The scan job may not exist or database access failed.
        </p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-sm border border-border hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="border-b border-border pb-6">
        <h2 className="font-display text-3xl font-bold uppercase tracking-wider text-foreground">
          Scan Execution Pipeline
        </h2>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          ID: {scanId}
        </p>
      </div>

      <div className="border border-border bg-card p-8 rounded-sm">
        <ScanTimeline
          currentStage={status}
          percentage={
            progress?.percentage ?? (scan.status === "queued" ? 5 : 40)
          }
          message={
            progress?.message ??
            (scan.status === "queued"
              ? "Enqueued and waiting for worker..."
              : "Restoring state...")
          }
        />
      </div>

      {status === "completed" && (
        <div className="flex justify-end">
          <button
            onClick={() => router.push(`/scans/${scanId}/report`)}
            className="inline-flex items-center gap-2 px-6 py-3 font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 transition-all"
          >
            <FileText className="w-4.5 h-4.5" />
            <span>View Audit Report</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {status === "failed" && (
        <div className="p-4 rounded-sm bg-destructive/10 border border-destructive/20 flex gap-3 items-center text-destructive text-xs">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-bold">Scan Execution Blocked</p>
            <p className="text-muted-foreground mt-0.5">
              {failureMessage}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
