"use client";

import React from "react";
import { STANDARDS_REFERENCES } from "@slopshield/shared";
import {
  Activity,
  Clock,
  Cpu,
  ExternalLink,
  Gauge,
  ShieldCheck,
  XCircle,
  CheckCircle2,
  MinusCircle,
} from "lucide-react";

interface Finding {
  severity: string;
  standardReferences?: string[] | null;
  falsePositive?: boolean;
}

interface CoverageEntry {
  analyzer: string;
  status: string;
  findingCount: number;
  durationMs: number;
  reason?: string;
}

interface ScanMetrics {
  queueWaitMs?: number | null;
  fetchMs?: number | null;
  classifyMs?: number | null;
  staticAnalysisMs?: number | null;
  aiReviewMs?: number | null;
  scoringMs?: number | null;
  totalMs?: number | null;
  totalFiles?: number | null;
  analyzedFiles?: number | null;
  aiInputTokens?: number | null;
  aiOutputTokens?: number | null;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;
const SEVERITY_COLORS: Record<string, string> = {
  critical: "var(--color-severity-critical, #ef4444)",
  high: "var(--color-severity-high, #f97316)",
  medium: "var(--color-severity-medium, #f59e0b)",
  low: "var(--color-severity-low, #3b82f6)",
  info: "var(--color-severity-info, #6b7280)",
};

function ms(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

/**
 * Severity distribution as a labeled stacked bar — gives an at-a-glance read on
 * how findings break down by severity without pulling in a chart runtime.
 */
function SeverityDistribution({ findings }: { findings: Finding[] }) {
  const counts = SEVERITY_ORDER.map((sev) => ({
    sev,
    count: findings.filter((f) => f.severity === sev).length,
  }));
  const total = counts.reduce((a, c) => a + c.count, 0);

  return (
    <div className="border border-border bg-card p-5 rounded-sm space-y-3">
      <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5" /> Severity Distribution
      </h4>
      <div className="flex h-3 w-full overflow-hidden rounded-sm border border-border bg-muted">
        {total === 0 ? (
          <div className="w-full bg-status-passed/30" />
        ) : (
          counts.map(({ sev, count }) =>
            count > 0 ? (
              <div
                key={sev}
                style={{
                  width: `${(count / total) * 100}%`,
                  backgroundColor: SEVERITY_COLORS[sev],
                }}
                title={`${sev}: ${count}`}
              />
            ) : null,
          )
        )}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {counts.map(({ sev, count }) => (
          <div key={sev} className="text-center">
            <div
              className="font-display text-lg font-bold"
              style={{ color: SEVERITY_COLORS[sev] }}
            >
              {count}
            </div>
            <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
              {sev}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusIcon(status: string) {
  if (status === "ran") return <CheckCircle2 className="w-3.5 h-3.5 text-status-passed" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-destructive" />;
  return <MinusCircle className="w-3.5 h-3.5 text-muted-foreground" />;
}

/** Which analyzers ran, were skipped, or failed — and why. */
function AnalyzerCoverageCard({ coverage }: { coverage: CoverageEntry[] }) {
  if (!coverage || coverage.length === 0) return null;
  return (
    <div className="border border-border bg-card p-5 rounded-sm space-y-3">
      <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5" /> Analyzer Coverage
      </h4>
      <div className="space-y-1.5">
        {coverage.map((c) => (
          <div
            key={c.analyzer}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="flex items-center gap-1.5 font-mono">
              {statusIcon(c.status)}
              {c.analyzer}
            </span>
            <span className="text-muted-foreground font-mono text-[10px]">
              {c.status === "ran"
                ? `${c.findingCount} findings · ${ms(c.durationMs)}`
                : c.reason || c.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Per-stage timing breakdown + AI token usage from the persisted ScanMetrics. */
function ScanMetricsPanel({ metrics }: { metrics: ScanMetrics | null }) {
  if (!metrics) return null;
  const stages: { label: string; value?: number | null }[] = [
    { label: "Queue wait", value: metrics.queueWaitMs },
    { label: "Indexing", value: metrics.fetchMs },
    { label: "Classify", value: metrics.classifyMs },
    { label: "Static analysis", value: metrics.staticAnalysisMs },
    { label: "AI review", value: metrics.aiReviewMs },
    { label: "Scoring", value: metrics.scoringMs },
  ];
  const total = metrics.totalMs ?? 0;

  return (
    <div className="border border-border bg-card p-5 rounded-sm space-y-3">
      <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" /> Scan Performance
      </h4>
      <div className="space-y-2">
        {stages.map((s) => {
          const pct =
            total > 0 && s.value ? Math.min(100, (s.value / total) * 100) : 0;
          return (
            <div key={s.label} className="space-y-1">
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                <span>{s.label}</span>
                <span>{ms(s.value)}</span>
              </div>
              <div className="h-1 w-full bg-muted rounded-none overflow-hidden">
                <div
                  className="h-full bg-ring/60"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border pt-3 grid grid-cols-3 gap-2 text-center">
        <Metric icon={<Gauge className="w-3 h-3" />} label="Total" value={ms(total)} />
        <Metric
          icon={<Cpu className="w-3 h-3" />}
          label="Files"
          value={`${metrics.analyzedFiles ?? "—"}/${metrics.totalFiles ?? "—"}`}
        />
        <Metric
          icon={<Cpu className="w-3 h-3" />}
          label="AI tokens"
          value={
            metrics.aiInputTokens || metrics.aiOutputTokens
              ? `${(metrics.aiInputTokens ?? 0) + (metrics.aiOutputTokens ?? 0)}`
              : "—"
          }
        />
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        {icon}
      </div>
      <div className="font-display text-sm font-bold text-foreground mt-0.5">
        {value}
      </div>
      <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/** Distinct engineering standards referenced across findings, linked out. */
function ComplianceCard({ findings }: { findings: Finding[] }) {
  const refs = new Map<string, number>();
  for (const f of findings) {
    for (const ref of f.standardReferences ?? []) {
      refs.set(ref, (refs.get(ref) ?? 0) + 1);
    }
  }
  if (refs.size === 0) return null;
  const sorted = [...refs.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="border border-border bg-card p-5 rounded-sm space-y-3">
      <h4 className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5" /> Standards Mapped
      </h4>
      <div className="flex flex-wrap gap-2">
        {sorted.map(([ref, count]) => {
          const known = (
            STANDARDS_REFERENCES as Record<
              string,
              { shortName: string; url: string }
            >
          )[ref];
          const label = known?.shortName ?? ref;
          const body = (
            <>
              <span className="text-xs font-bold text-ring font-mono">{label}</span>
              <span className="text-[9px] text-muted-foreground">×{count}</span>
              {known?.url && <ExternalLink className="w-3 h-3 text-ring/70" />}
            </>
          );
          return known?.url ? (
            <a
              key={ref}
              href={known.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex gap-1.5 items-center p-2 rounded-sm bg-ring/5 border border-ring/15 hover:bg-ring/10 transition-colors"
            >
              {body}
            </a>
          ) : (
            <span
              key={ref}
              className="inline-flex gap-1.5 items-center p-2 rounded-sm bg-ring/5 border border-ring/15"
            >
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function ReportInsights({
  findings,
  metrics,
  coverage,
}: {
  findings: Finding[];
  metrics: ScanMetrics | null;
  coverage: CoverageEntry[];
}) {
  return (
    <section className="space-y-4">
      <h3 className="font-display text-lg font-bold uppercase tracking-wider text-muted-foreground">
        Scan Insights & Observability
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SeverityDistribution findings={findings} />
        <ScanMetricsPanel metrics={metrics} />
        <AnalyzerCoverageCard coverage={coverage} />
        <ComplianceCard findings={findings} />
      </div>
    </section>
  );
}
