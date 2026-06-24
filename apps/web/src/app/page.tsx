"use client";

import React from "react";
import Link from "next/link";
import { useScans } from "@/hooks/use-scans";
import { useMe } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/skeleton";
import {
  ShieldAlert,
  PlusCircle,
  ArrowRight,
  ShieldCheck,
  Zap,
  Server,
  BarChart3,
  Database,
} from "lucide-react";

export default function HomePage() {
  const { data: scansData, isLoading } = useScans(1, 5);
  const { data: me } = useMe();

  const recentScans = scansData?.items || [];

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <section className="relative bg-card border border-border p-8 md:p-12 overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />

        <div className="flex-1 space-y-6 text-center md:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-500 text-xs font-semibold uppercase tracking-wider">
            <Zap className="w-3.5 h-3.5" /> Next-Gen AI Code Guard
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground leading-tight">
            Stop AI Code Slop <br />
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Before It Reaches Production
            </span>
          </h2>
          <p className="text-muted-foreground max-w-xl text-sm md:text-base leading-relaxed">
            SlopShield AI automatically reviews pasted code, files, or Git pull
            requests for hardcoded secrets, accessibility failures, type errors,
            architectural anti-patterns, and AI-generated hallucinations.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center md:justify-start">
            <Link
              href="/scans/new"
              className="inline-flex items-center gap-2 px-6 py-3 font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <PlusCircle className="w-5 h-5" />
              Start New Scan
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-6 py-3 font-bold rounded-sm border border-border bg-transparent text-foreground hover:bg-muted transition-colors"
            >
              Go to Analytics
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Animated Cyber Shield Graphic */}
        <div className="flex-1 flex justify-center items-center relative select-none">
          <div className="absolute w-48 h-48 bg-cyan-500/5 rounded-full blur-2xl animate-glow-pulse" />
          <div className="relative p-6 border border-cyan-500/20 rounded-full bg-cyan-500/5 animate-spin-slow">
            <div className="p-6 border border-cyan-500/30 rounded-full bg-cyan-500/5">
              <div className="p-6 border border-cyan-500/40 rounded-full bg-cyan-500/5">
                <div className="w-16 h-16" />
              </div>
            </div>
          </div>
          <div className="absolute p-4 rounded-xl bg-card border border-cyan-500/30 shadow-2xl animate-float">
            <ShieldCheck className="w-12 h-12 text-cyan-400" />
          </div>
        </div>
      </section>

      {/* Grid Features */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-card border border-border">
          <div className="p-3 bg-cyan-500/10 rounded-sm text-cyan-500 w-fit mb-4">
            <Server className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold mb-2">
            Static Analysis Orchestration
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Checks TypeScript compiler diagnostics, ESLint configuration rules,
            and scans regex patterns for hardcoded credentials.
          </p>
        </div>

        <div className="p-6 bg-card border border-border">
          <div className="p-3 bg-blue-500/10 rounded-sm text-blue-500 w-fit mb-4">
            <Zap className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold mb-2">Gemini AI Code Reviewer</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Applies LLM analysis to identify architectural smells, test coverage
            gaps, accessibility blocks, and logic redundancies.
          </p>
        </div>

        <div className="p-6 bg-card border border-border">
          <div className="p-3 bg-purple-500/10 rounded-sm text-purple-500 w-fit mb-4">
            <BarChart3 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold mb-2">Standards & Mappings</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Maps identified codebase smells directly to industry compliance
            frameworks including OWASP Top 10, CWE Top 25, and WCAG 2.2.
          </p>
        </div>
      </section>

      {/* Recent Scans Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-foreground">
            Recent Scans
          </h3>
          <Link
            href="/scans"
            className="text-xs font-bold text-ring hover:text-ring/80 flex items-center gap-1"
          >
            View All Scans
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="border border-border rounded-sm overflow-hidden bg-card">
          {isLoading ? (
            <div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="p-4 border-b border-border last:border-0 flex items-center justify-between"
                >
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          ) : recentScans.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No scans executed yet. Click &quot;Start New Scan&quot; above to
              run your first check!
            </div>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <th className="px-6 py-3.5">Scan ID</th>
                    <th className="px-6 py-3.5">Source Type</th>
                    <th className="px-6 py-3.5">Score</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Executed At</th>
                    <th className="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-sm">
                  {recentScans.map((scan: any) => (
                    <tr
                      key={scan.id}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-6 py-4 font-mono text-xs font-semibold text-foreground truncate max-w-xs">
                        {scan.id}
                      </td>
                      <td className="px-6 py-4 capitalize text-xs font-medium text-muted-foreground">
                        {scan.sourceType}
                      </td>
                      <td className="px-6 py-4 font-bold text-foreground">
                        {scan.overallScore !== null
                          ? `${scan.overallScore}/100`
                          : "N/A"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge
                          status={scan.statusResult || scan.status}
                        />
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(scan.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <Link
                          href={
                            scan.status === "completed"
                              ? `/scans/${scan.id}/report`
                              : `/scans/${scan.id}/progress`
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-sm bg-muted text-foreground border border-border hover:bg-cyan-500/10 hover:text-cyan-500 hover:border-cyan-500/20 transition-colors"
                        >
                          View{" "}
                          {scan.status === "completed" ? "Report" : "Progress"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden">
              {recentScans.map((scan: any) => (
                <div
                  key={`${scan.id}-card`}
                  className="p-4 border-b border-border last:border-0 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground truncate">
                      {scan.id}
                    </span>
                    <StatusBadge status={scan.statusResult || scan.status} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="capitalize font-medium text-muted-foreground">
                      {scan.sourceType}
                    </span>
                    <span className="font-bold text-foreground">
                      {scan.overallScore !== null
                        ? `${scan.overallScore}/100`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(scan.createdAt).toLocaleString()}
                    </span>
                    <Link
                      href={
                        scan.status === "completed"
                          ? `/scans/${scan.id}/report`
                          : `/scans/${scan.id}/progress`
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-sm bg-muted text-foreground border border-border hover:bg-cyan-500/10 hover:text-cyan-500 hover:border-cyan-500/20 transition-colors"
                    >
                      View{" "}
                      {scan.status === "completed" ? "Report" : "Progress"}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
