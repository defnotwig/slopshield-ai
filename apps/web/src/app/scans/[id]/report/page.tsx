"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useScan } from "@/hooks/use-scans";
import { ScoreGauge } from "@/components/score-gauge";
import { CategoryScores } from "@/components/category-scores";
import { FindingsTable } from "@/components/findings-table";
import { FindingDetail } from "./finding-detail";
import { StatusBadge } from "@/components/status-badge";
import { apiClient } from "@/lib/api-client";
import {
  ArrowLeft,
  ShieldAlert,
  Sparkles,
  CheckSquare,
  RefreshCw,
  Download,
  ExternalLink,
  FileWarning,
  ShieldCheck,
  HelpCircle,
  Loader2,
} from "lucide-react";

export default function ScanReportPage() {
  const params = useParams();
  const router = useRouter();
  const scanId = params.id as string;

  const { data: scan, isLoading, isError, refetch } = useScan(scanId);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
    null,
  );

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState("");

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
        <p className="text-sm font-mono text-gray-500">
          Compiling quality report data...
        </p>
      </div>
    );
  }

  if (isError || !scan) {
    return (
      <div className="max-w-md mx-auto py-24 text-center space-y-4">
        <div className="p-4 bg-red-500/10 text-red-500 rounded-full w-fit mx-auto border border-red-500/20">
          <FileWarning className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold">Failed to load audit report</h3>
        <p className="text-xs text-gray-500">
          Verify network connection or DB schema initialization.
        </p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  const findings = scan.findings || [];
  const blockingFindings = findings.filter(
    (f: any) => f.blocking && !f.falsePositive,
  );
  const activeFindings = findings.filter((f: any) => !f.falsePositive);

  const handleRerunScan = async () => {
    setActionLoading("rerun");
    setActionMsg("");
    try {
      const res = await apiClient.post<any>(`/scans/${scanId}/rerun`, {});
      router.push(`/scans/${res.id}/progress`);
    } catch (err: any) {
      setActionMsg(err.message || "Rerun failed.");
      setActionLoading(null);
    }
  };

  const handleExportJson = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(scan, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `slopshield_report_${scanId}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const scoreData = {
    security: scan.securityScore ?? 100,
    maintainability: scan.maintainabilityScore ?? 100,
    architecture: scan.architectureScore ?? 100,
    testability: scan.testabilityScore ?? 100,
    frontend: scan.frontendScore ?? 100,
    backend: scan.backendScore ?? 100,
  };

  // Convert refactorPlan to string array safely
  const refactorPlanArray = Array.isArray(scan.refactorPlan)
    ? scan.refactorPlan
    : typeof scan.refactorPlan === "string"
      ? JSON.parse(scan.refactorPlan || "[]")
      : [];

  // Convert recommendedTests to string array safely
  const recommendedTestsArray = Array.isArray(scan.recommendedTests)
    ? scan.recommendedTests
    : typeof scan.recommendedTests === "string"
      ? JSON.parse(scan.recommendedTests || "[]")
      : [];

  return (
    <div className="space-y-8 relative">
      {/* Top Navigation Row */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-border pb-6">
        <button
          onClick={() => router.push("/scans")}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-widest"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to History</span>
        </button>

        <div className="flex gap-3 items-center">
          <button
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-sm border border-border bg-muted/20 text-foreground hover:bg-foreground hover:text-background transition-colors"
          >
            <Download className="w-4 h-4" />
            Export JSON
          </button>

          <button
            onClick={handleRerunScan}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-all animate-none"
          >
            <RefreshCw
              className={`w-4 h-4 ${actionLoading === "rerun" ? "animate-spin" : ""}`}
            />
            Rerun Audit
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className="p-3 rounded-sm bg-destructive/10 border border-destructive/20 text-xs font-bold text-destructive text-center">
          {actionMsg}
        </div>
      )}

      {/* Blocker Banner */}
      {blockingFindings.length > 0 && (
        <div className="p-4 rounded-sm bg-destructive/10 border border-destructive/20 flex gap-3.5 items-start text-destructive">
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm">
              Merge Blocked by Quality Rules
            </h4>
            <p className="text-xs leading-relaxed opacity-90">
              This codebase has been automatically blocked from production
              release. We detected{" "}
              <strong>
                {blockingFindings.length} unresolved critical blockers
              </strong>
              . Rerun the scan once the code has been patched.
            </p>
          </div>
        </div>
      )}

      {blockingFindings.length === 0 &&
        scan.overallScore >= (scan.project?.minimumScore || 80) && (
          <div className="p-4 rounded-sm bg-status-passed/10 border border-status-passed/20 flex gap-3.5 items-start text-status-passed">
            <ShieldCheck className="w-5.5 h-5.5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-sm">Code Quality Approved</h4>
              <p className="text-xs leading-relaxed opacity-90">
                The scan meets all quality requirements. Overall quality score (
                {scan.overallScore}/100) is at or above the threshold (
                {scan.project?.minimumScore || 80}/100) with zero active
                blockers.
              </p>
            </div>
          </div>
        )}

      {/* Score Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Radial Gauge */}
        <div className="border border-border bg-card p-8 rounded-sm flex flex-col items-center justify-center gap-4 min-h-[250px]">
          <ScoreGauge score={scan.overallScore ?? 0} size={190} />
          {(scan.statusResult || scan.status) && (
            <StatusBadge status={scan.statusResult || scan.status} />
          )}
        </div>

        {/* AI Executive Summary Card */}
        <div className="lg:col-span-2 border border-border bg-card p-6 rounded-sm flex flex-col justify-between">
          <div className="space-y-4">
            <span className="text-[10px] font-bold text-muted-foreground flex gap-1.5 items-center tracking-widest uppercase">
              <Sparkles className="w-4 h-4 text-ring" />
              Gemini AI Executive Summary Pass
            </span>
            <p className="text-sm text-foreground leading-relaxed font-medium">
              {scan.aiSummary || "AI review summary is not initialized."}
            </p>
          </div>

          <div className="border-t border-border pt-4 mt-6 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                Findings
              </p>
              <p className="font-display text-2xl font-extrabold text-foreground mt-1">
                {activeFindings.length}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                Blockers
              </p>
              <p className="font-display text-2xl font-extrabold text-destructive mt-1">
                {blockingFindings.length}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                Profile Mode
              </p>
              <p className="text-xs font-bold text-ring mt-2.5 uppercase tracking-wider">
                {scan.scanMode}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Category Scores Breakdown */}
      <section className="space-y-4">
        <h3 className="font-display text-lg font-bold uppercase tracking-wider text-muted-foreground">
          Category Score Breakdown
        </h3>
        <CategoryScores scores={scoreData} />
      </section>

      {/* Findings Table */}
      <section className="space-y-4">
        <h3 className="font-display text-lg font-bold uppercase tracking-wider text-muted-foreground">
          Audited Findings Details
        </h3>
        <FindingsTable
          findings={activeFindings}
          onSelectFinding={(f) => setSelectedFindingId(f.id)}
        />
      </section>

      {/* Refactor Plan Section */}
      {(refactorPlanArray.length > 0 || recommendedTestsArray.length > 0) && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Refactor plan */}
          {refactorPlanArray.length > 0 && (
            <div className="border border-border bg-card p-6 rounded-sm space-y-4">
              <h4 className="font-display text-base font-bold flex gap-1.5 items-center text-ring uppercase tracking-wider">
                <Sparkles className="w-4 h-4" />
                AI-Suggested Refactoring Steps
              </h4>
              <ol className="space-y-2 list-decimal pl-5 text-xs text-muted-foreground">
                {refactorPlanArray.map((step: string, idx: number) => (
                  <li key={idx} className="leading-relaxed">
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Recommended Tests */}
          {recommendedTestsArray.length > 0 && (
            <div className="border border-border bg-card p-6 rounded-sm space-y-4">
              <h4 className="font-display text-base font-bold flex gap-1.5 items-center text-status-warning uppercase tracking-wider">
                <CheckSquare className="w-4 h-4" />
                Recommended Test Coverage Checks
              </h4>
              <ul className="space-y-2 list-disc pl-5 text-xs text-muted-foreground">
                {recommendedTestsArray.map((test: string, idx: number) => (
                  <li key={idx} className="leading-relaxed">
                    {test}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Slide-out Overlay Drawer for Finding Detail */}
      {selectedFindingId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end transition-opacity">
          {/* Backdrop Closer */}
          <div
            className="absolute inset-0"
            onClick={() => setSelectedFindingId(null)}
          />

          <div className="relative w-full max-w-xl bg-background border-l border-border h-full overflow-y-auto p-8 shadow-2xl flex flex-col justify-between">
            <FindingDetail
              findingId={selectedFindingId}
              onClose={() => setSelectedFindingId(null)}
              onUpdate={() => refetch()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
