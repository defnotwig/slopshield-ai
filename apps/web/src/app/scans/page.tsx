"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useScans } from "@/hooks/use-scans";
import { useProjects } from "@/hooks/use-projects";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/skeleton";
import {
  Calendar,
  RefreshCw,
  FolderOpen,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";

export default function ScansHistoryPage() {
  const [page, setPage] = useState(1);
  const [projectId, setProjectId] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const { data: projects = [] } = useProjects();
  const {
    data: scansData,
    isLoading,
    isError,
    refetch,
  } = useScans(page, 10, projectId, status);

  const scans = scansData?.items || [];
  const totalPages = scansData?.totalPages || 1;

  const handlePrevPage = () => {
    if (page > 1) setPage((p) => p - 1);
  };

  const handleNextPage = () => {
    if (page < totalPages) setPage((p) => p + 1);
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            Scan Audit History
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Browse and query all historical quality scans across your projects.
          </p>
        </div>

        <button
          onClick={() => refetch()}
          className="p-2 text-muted-foreground hover:text-foreground rounded-sm hover:bg-muted transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-sm">
        <div className="flex flex-wrap gap-4 items-center w-full">
          {/* Project Filter */}
          <div className="flex flex-col w-full sm:w-auto">
            <label
              htmlFor="scans-filter-project"
              className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1"
            >
              Project
            </label>
            <select
              id="scans-filter-project"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">All Projects</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex flex-col w-full sm:w-auto">
            <label
              htmlFor="scans-filter-status"
              className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1"
            >
              Status Verdict
            </label>
            <select
              id="scans-filter-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 capitalize"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="fetching">Fetching</option>
              <option value="ai-reviewing">AI-Reviewing</option>
            </select>
          </div>
        </div>
      </div>

      {/* Scans List Table */}
      <div className="border border-border rounded-sm overflow-hidden bg-card">
        {isLoading ? (
          <div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`scan-skeleton-${i}`}
                className="p-4 border-b border-border last:border-0 flex items-center justify-between"
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
            <div className="p-4 bg-destructive/10 text-destructive rounded-full w-fit mx-auto border border-destructive/20">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-foreground">
                Failed to load scan history
              </h3>
              <p className="text-xs text-muted-foreground">
                We couldn&apos;t reach the scan service. Check your API server
                connection and try again.
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-sm border border-border hover:bg-muted transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        ) : scans.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No scan logs match the current filters.
          </div>
        ) : (
          <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="px-6 py-3.5">Scan Job ID</th>
                  <th className="px-6 py-3.5">Project</th>
                  <th className="px-6 py-3.5">Source Type</th>
                  <th className="px-6 py-3.5">Quality Score</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Triggered At</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {scans.map((scan: any) => (
                  <tr
                    key={scan.id}
                    className="hover:bg-muted/50 transition-colors"
                  >
                    <td className="px-6 py-4.5 font-mono text-xs font-semibold text-foreground max-w-[180px] truncate">
                      {scan.id}
                    </td>
                    <td className="px-6 py-4.5 whitespace-nowrap">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                        {scan.project?.name || (
                          <span className="italic text-muted-foreground">Ad-Hoc</span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4.5 capitalize text-xs font-medium text-muted-foreground whitespace-nowrap">
                      {scan.sourceType}
                    </td>
                    <td className="px-6 py-4.5 font-bold text-foreground whitespace-nowrap">
                      {scan.overallScore !== null
                        ? `${scan.overallScore}/100`
                        : "N/A"}
                    </td>
                    <td className="px-6 py-4.5 whitespace-nowrap">
                      <StatusBadge status={scan.statusResult || scan.status} />
                    </td>
                    <td className="px-6 py-4.5 text-xs text-muted-foreground whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(scan.createdAt).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4.5 text-right whitespace-nowrap">
                      <Link
                        href={
                          scan.status === "completed"
                            ? `/scans/${scan.id}/report`
                            : `/scans/${scan.id}/progress`
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-sm bg-muted text-foreground border border-border hover:bg-cyan-500/10 hover:text-cyan-500 hover:border-cyan-500/20 transition-colors"
                      >
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Fallback */}
          <div className="md:hidden">
            {scans.map((scan: any) => (
              <div
                key={`${scan.id}-card`}
                className="p-4 border-b border-border last:border-0 space-y-2"
              >
                <div className="font-mono text-xs font-semibold text-foreground truncate">
                  {scan.id}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                    {scan.project?.name || (
                      <span className="italic text-muted-foreground">Ad-Hoc</span>
                    )}
                  </span>
                  <StatusBadge status={scan.statusResult || scan.status} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="capitalize text-xs font-medium text-muted-foreground">
                    {scan.sourceType}
                  </span>
                  <span className="font-bold text-sm text-foreground">
                    {scan.overallScore !== null
                      ? `${scan.overallScore}/100`
                      : "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5" />
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
                    Inspect
                  </Link>
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handlePrevPage}
              disabled={page === 1}
              className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold rounded-sm border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
              Previous
            </button>
            <button
              onClick={handleNextPage}
              disabled={page === totalPages}
              className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold rounded-sm border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors"
            >
              Next
              <ArrowRight className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
