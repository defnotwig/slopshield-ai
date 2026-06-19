"use client";

import React from "react";
import Link from "next/link";
import { useScans } from "@/hooks/use-scans";
import { useMe } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/status-badge";
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
      <section className="relative glass-card bg-gradient-to-r from-gray-900/80 to-gray-950/80 border border-gray-200 dark:border-gray-800 p-8 md:p-12 overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />

        <div className="flex-1 space-y-6 text-center md:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-500 text-xs font-semibold uppercase tracking-wider">
            <Zap className="w-3.5 h-3.5" /> Next-Gen AI Code Guard
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white leading-tight">
            Stop AI Code Slop <br />
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Before It Reaches Production
            </span>
          </h2>
          <p className="text-gray-500 dark:text-gray-400 max-w-xl text-sm md:text-base leading-relaxed">
            SlopShield AI automatically reviews pasted code, files, or Git pull
            requests for hardcoded secrets, accessibility failures, type errors,
            architectural anti-patterns, and AI-generated hallucinations.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center md:justify-start">
            <Link
              href="/scans/new"
              className="inline-flex items-center gap-2 px-6 py-3 font-bold rounded-lg bg-cyan-500 text-gray-950 hover:bg-cyan-400 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 shadow-lg shadow-cyan-500/20"
            >
              <PlusCircle className="w-5 h-5" />
              Start New Scan
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-6 py-3 font-bold rounded-lg border border-gray-200 dark:border-gray-800 bg-white/5 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-900 text-gray-700 dark:text-gray-200 transition-colors"
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
          <div className="absolute p-4 rounded-xl bg-gray-900/80 border border-cyan-500/30 shadow-2xl animate-float">
            <ShieldCheck className="w-12 h-12 text-cyan-400" />
          </div>
        </div>
      </section>

      {/* Grid Features */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 bg-white dark:bg-gray-900/30 border border-gray-200 dark:border-gray-800">
          <div className="p-3 bg-cyan-500/10 rounded-lg text-cyan-500 w-fit mb-4">
            <Server className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold mb-2">
            Static Analysis Orchestration
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Checks TypeScript compiler diagnostics, ESLint configuration rules,
            and scans regex patterns for hardcoded credentials.
          </p>
        </div>

        <div className="glass-card p-6 bg-white dark:bg-gray-900/30 border border-gray-200 dark:border-gray-800">
          <div className="p-3 bg-blue-500/10 rounded-lg text-blue-500 w-fit mb-4">
            <Zap className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold mb-2">Gemini AI Code Reviewer</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Applies LLM analysis to identify architectural smells, test coverage
            gaps, accessibility blocks, and logic redundancies.
          </p>
        </div>

        <div className="glass-card p-6 bg-white dark:bg-gray-900/30 border border-gray-200 dark:border-gray-800">
          <div className="p-3 bg-purple-500/10 rounded-lg text-purple-500 w-fit mb-4">
            <BarChart3 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold mb-2">Standards & Mappings</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Maps identified codebase smells directly to industry compliance
            frameworks including OWASP Top 10, CWE Top 25, and WCAG 2.2.
          </p>
        </div>
      </section>

      {/* Recent Scans Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-150">
            Recent Scans
          </h3>
          <Link
            href="/scans"
            className="text-xs font-bold text-cyan-500 hover:text-cyan-400 flex items-center gap-1"
          >
            View All Scans
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-950/20">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-gray-500 font-mono">
              Loading recent scans...
            </div>
          ) : recentScans.length === 0 ? (
            <div className="p-12 text-center text-sm text-gray-500 dark:text-gray-400">
              No scans executed yet. Click &quot;Start New Scan&quot; above to
              run your first check!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/35 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    <th className="px-6 py-3.5">Scan ID</th>
                    <th className="px-6 py-3.5">Source Type</th>
                    <th className="px-6 py-3.5">Score</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Executed At</th>
                    <th className="px-6 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-850 text-sm">
                  {recentScans.map((scan: any) => (
                    <tr
                      key={scan.id}
                      className="hover:bg-gray-50/50 dark:hover:bg-gray-900/20 transition-colors"
                    >
                      <td className="px-6 py-4 font-mono text-xs font-semibold text-gray-900 dark:text-gray-100 truncate max-w-xs">
                        {scan.id}
                      </td>
                      <td className="px-6 py-4 capitalize text-xs font-medium text-gray-500 dark:text-gray-400">
                        {scan.sourceType}
                      </td>
                      <td className="px-6 py-4 font-bold text-gray-900 dark:text-gray-100">
                        {scan.overallScore !== null
                          ? `${scan.overallScore}/100`
                          : "N/A"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge
                          status={scan.statusResult || scan.status}
                        />
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {new Date(scan.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <Link
                          href={
                            scan.status === "completed"
                              ? `/scans/${scan.id}/report`
                              : `/scans/${scan.id}/progress`
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-800 hover:bg-cyan-500/10 hover:text-cyan-500 hover:border-cyan-500/20 transition-colors"
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
          )}
        </div>
      </section>
    </div>
  );
}
