"use client";

import React, { useState, useEffect } from "react";
import { SeverityBadge } from "@/components/severity-badge";
import { CodeViewer } from "@/components/code-viewer";
import { apiClient } from "@/lib/api-client";
import { STANDARDS_REFERENCES } from "@slopshield/shared";
import {
  X,
  Check,
  AlertCircle,
  Sparkles,
  Loader2,
  CheckSquare,
  ExternalLink,
} from "lucide-react";

interface Finding {
  id: string;
  filePath: string | null;
  lineNumber: number | null;
  severity: string;
  category: string;
  title: string;
  description: string | null;
  standardReferences: string[] | null;
  recommendation: string | null;
  suggestedTests: any;
  blocking: boolean;
  confidence: number | null;
  codeSnippet: string | null;
  falsePositive: boolean;
}

/**
 * Resolve a stored standard token (e.g. "OWASP_TOP_10" or free text like
 * "CWE-79") to a human label + external URL. Falls back to the raw token when
 * it is not a known reference key.
 */
function resolveStandard(ref: string): { label: string; url: string | null } {
  const known = (STANDARDS_REFERENCES as Record<string, { shortName: string; url: string }>)[ref];
  if (known) {
    return { label: known.shortName, url: known.url };
  }
  return { label: ref, url: null };
}

interface FindingDetailProps {
  findingId: string;
  onClose: () => void;
  onUpdate: () => void;
}

export function FindingDetail({
  findingId,
  onClose,
  onUpdate,
}: FindingDetailProps) {
  const [finding, setFinding] = useState<Finding | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiFixPlan, setAiFixPlan] = useState<string[] | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    let active = true;
    const fetchFinding = async () => {
      setLoading(true);
      try {
        const res = await apiClient.get<Finding>(`/findings/${findingId}`);
        if (active) {
          setFinding(res);
        }
      } catch (err) {
        console.error("Failed to fetch finding details", err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchFinding();
    return () => {
      active = false;
    };
  }, [findingId]);

  const handleMarkFalsePositive = async () => {
    if (!finding) return;
    setActionLoading("false-positive");
    setSuccessMsg("");
    try {
      const updated = await apiClient.post<any>(
        `/findings/${finding.id}/false-positive`,
        {
          falsePositive: !finding.falsePositive,
        },
      );
      setFinding((prev) =>
        prev ? { ...prev, falsePositive: updated.falsePositive } : null,
      );
      setSuccessMsg(
        updated.falsePositive
          ? "Marked as false positive."
          : "Restored from false positive.",
      );
      onUpdate();
    } catch (err: any) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateFixTask = async () => {
    if (!finding) return;
    setActionLoading("create-task");
    setSuccessMsg("");
    try {
      await apiClient.post(`/findings/${finding.id}/create-task`, {});
      setSuccessMsg("Fix task created and assigned successfully.");
      onUpdate();
    } catch (err: any) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateFixPlan = async () => {
    if (!finding) return;
    setGeneratingPlan(true);
    try {
      const plan = await apiClient.post<string[]>(
        `/findings/${finding.id}/generate-fix-plan`,
      );
      setAiFixPlan(plan);
    } catch (err: any) {
      console.error(err);
    } finally {
      setGeneratingPlan(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-ring animate-spin" />
      </div>
    );
  }

  if (!finding) {
    return (
      <div className="p-6 text-center text-muted-foreground">Finding not found.</div>
    );
  }

  const suggestedTestsArray = Array.isArray(finding.suggestedTests)
    ? finding.suggestedTests
    : typeof finding.suggestedTests === "string"
      ? JSON.parse(finding.suggestedTests || "[]")
      : [];

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex items-start justify-between border-b border-border pb-4">
        <div>
          <div className="flex flex-wrap gap-2 items-center">
            <SeverityBadge severity={finding.severity} />
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-none bg-muted border border-border capitalize">
              {finding.category}
            </span>
            {finding.blocking && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-none bg-destructive/10 text-destructive border border-destructive/20">
                BLOCKER
              </span>
            )}
            {finding.falsePositive && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-none bg-muted border border-border text-muted-foreground">
                FALSE POSITIVE
              </span>
            )}
          </div>
          <h3 className="font-display text-2xl font-bold text-foreground mt-2 uppercase tracking-wide">
            {finding.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            {finding.filePath
              ? `${finding.filePath}${finding.lineNumber ? `:${finding.lineNumber}` : ""}`
              : "Project-wide"}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-sm hover:bg-muted border border-transparent hover:border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {successMsg && (
        <div className="p-3 rounded-sm bg-status-passed/10 border border-status-passed/20 text-xs font-bold text-status-passed flex gap-2 items-center">
          <Check className="w-4 h-4" />
          {successMsg}
        </div>
      )}

      {/* Why It Matters */}
      <div className="space-y-2">
        <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
          Why It Matters
        </h4>
        <p className="text-sm text-foreground leading-relaxed bg-muted/20 p-4 border border-border rounded-sm">
          {finding.description || "No detailed analysis provided."}
        </p>
      </div>

      {/* Code Snippet */}
      {finding.codeSnippet && (
        <div className="space-y-2">
          <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
            Violating Code Snippet
          </h4>
          <div className="border border-border rounded-sm overflow-hidden">
            <CodeViewer
              code={finding.codeSnippet}
              language={
                finding.filePath?.endsWith(".tsx") ? "typescript" : "javascript"
              }
              height="180px"
            />
          </div>
        </div>
      )}

      {/* Mapped Standards */}
      {finding.standardReferences && finding.standardReferences.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
            Standard Compliance References
          </h4>
          <div className="flex flex-wrap gap-2">
            {finding.standardReferences.map((ref) => {
              const { label, url } = resolveStandard(ref);
              const chipBody = (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-ring shrink-0" />
                  <span className="text-xs font-bold text-ring font-mono uppercase tracking-wider">
                    {label}
                  </span>
                  {url && <ExternalLink className="w-3 h-3 text-ring/70 shrink-0" />}
                </>
              );
              return url ? (
                <a
                  key={ref}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex gap-1.5 items-center p-2 rounded-sm bg-ring/5 border border-ring/15 hover:bg-ring/10 transition-colors"
                >
                  {chipBody}
                </a>
              ) : (
                <span
                  key={ref}
                  className="inline-flex gap-1.5 items-center p-2 rounded-sm bg-ring/5 border border-ring/15"
                >
                  {chipBody}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {finding.recommendation && (
        <div className="space-y-2">
          <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
            Remediation Recommendation
          </h4>
          <p className="text-sm text-foreground leading-relaxed bg-muted/20 p-4 border border-border rounded-sm">
            {finding.recommendation}
          </p>
        </div>
      )}

      {/* Suggested Tests */}
      {suggestedTestsArray.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
            Suggested Verification Tests
          </h4>
          <ul className="space-y-1.5 pl-5 list-disc text-xs text-muted-foreground">
            {suggestedTestsArray.map((test: string, idx: number) => (
              <li key={idx} className="leading-relaxed">
                {test}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI Refactor Plan Button & Section */}
      <div className="border-t border-border pt-4 space-y-4">
        <div className="flex justify-between items-center">
          <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
            AI Automated Fix Plan
          </h4>
          {!aiFixPlan && (
            <button
              onClick={handleGenerateFixPlan}
              disabled={generatingPlan}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-sm border border-border bg-muted/20 text-foreground hover:bg-foreground hover:text-background transition-all disabled:opacity-50"
            >
              {generatingPlan ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate Fix Steps</span>
                </>
              )}
            </button>
          )}
        </div>

        {aiFixPlan && (
          <div className="space-y-2.5 bg-ring/5 border border-ring/10 p-4 rounded-sm">
            <span className="text-[9px] font-bold text-ring flex gap-1.5 items-center tracking-widest uppercase mb-1">
              <Sparkles className="w-3.5 h-3.5" /> Ordered Fix Strategy
            </span>
            <ol className="space-y-2 list-decimal pl-5 text-xs text-muted-foreground">
              {aiFixPlan.map((step, idx) => (
                <li key={idx} className="leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="border-t border-border pt-4 flex flex-wrap gap-4 items-center justify-between">
        <button
          onClick={handleMarkFalsePositive}
          disabled={actionLoading !== null}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-sm border border-border bg-muted/20 text-foreground hover:bg-foreground hover:text-background transition-colors"
        >
          {actionLoading === "false-positive" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : finding.falsePositive ? (
            "Restore Finding"
          ) : (
            "Mark False Positive"
          )}
        </button>

        <button
          onClick={handleCreateFixTask}
          disabled={actionLoading !== null}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 transition-all"
        >
          {actionLoading === "create-task" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <CheckSquare className="w-4 h-4" />
              <span>Assign Fix Task</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
