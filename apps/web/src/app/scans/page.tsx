"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useScans } from "@/hooks/use-scans";
import { useProjects } from "@/hooks/use-projects";
import { StatusBadge } from "@/components/status-badge";
import {
  Search,
  Calendar,
  RefreshCw,
  FolderOpen,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";

export default function ScansHistoryPage() {
  const [page, setPage] = useState(1);
  const [projectId, setProjectId] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const { data: projects = [] } = useProjects();
  const {
    data: scansData,
    isLoading,
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
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Scan Audit History
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Browse and query all historical quality scans across your projects.
          </p>
        </div>

        <button
          onClick={() => refetch()}
          className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-150 dark:hover:bg-gray-900 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white dark:bg-gray-900/30 p-4 border border-gray-200 dark:border-gray-800 rounded-lg">
        <div className="flex flex-wrap gap-4 items-center w-full">
          {/* Project Filter */}
          <div className="flex flex-col w-full sm:w-auto">
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">
              Project
            </span>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-55 dark:bg-gray-950 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
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
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">
              Status Verdict
            </span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-55 dark:bg-gray-950 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500 capitalize"
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
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-gray-950/20">
        {isLoading ? (
          <div className="p-12 text-center text-sm font-mono text-gray-500">
            Fetching scan history...
          </div>
        ) : scans.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">
            No scan logs match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/35 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="px-6 py-3.5">Scan Job ID</th>
                  <th className="px-6 py-3.5">Project</th>
                  <th className="px-6 py-3.5">Source Type</th>
                  <th className="px-6 py-3.5">Quality Score</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Triggered At</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-850 text-sm">
                {scans.map((scan: any) => (
                  <tr
                    key={scan.id}
                    className="hover:bg-gray-50/50 dark:hover:bg-gray-900/20 transition-colors"
                  >
                    <td className="px-6 py-4.5 font-mono text-xs font-semibold text-gray-900 dark:text-gray-100 max-w-[180px] truncate">
                      {scan.id}
                    </td>
                    <td className="px-6 py-4.5 whitespace-nowrap">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
                        <FolderOpen className="w-3.5 h-3.5 text-gray-400" />
                        {scan.project?.name || (
                          <span className="italic text-gray-500">Ad-Hoc</span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4.5 capitalize text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {scan.sourceType}
                    </td>
                    <td className="px-6 py-4.5 font-bold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      {scan.overallScore !== null
                        ? `${scan.overallScore}/100`
                        : "N/A"}
                    </td>
                    <td className="px-6 py-4.5 whitespace-nowrap">
                      <StatusBadge status={scan.statusResult || scan.status} />
                    </td>
                    <td className="px-6 py-4.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
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
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-800 hover:bg-cyan-500/10 hover:text-cyan-500 hover:border-cyan-500/20 transition-colors"
                      >
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <span className="text-xs text-gray-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handlePrevPage}
              disabled={page === 1}
              className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-850 hover:bg-gray-100 dark:hover:bg-gray-900 disabled:opacity-40 transition-colors"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
              Previous
            </button>
            <button
              onClick={handleNextPage}
              disabled={page === totalPages}
              className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-850 hover:bg-gray-100 dark:hover:bg-gray-900 disabled:opacity-40 transition-colors"
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
