"use client";

import React, { useMemo, useState } from "react";
import { SeverityBadge } from "@/components/severity-badge";
import { Search, Eye, ArrowDownUp } from "lucide-react";

interface Finding {
  id: string;
  filePath: string | null;
  lineNumber: number | null;
  severity: string;
  category: string;
  title: string;
  description: string | null;
  blocking: boolean;
  source: string;
}

interface FindingsTableProps {
  findings: Finding[];
  onSelectFinding: (finding: Finding) => void;
}

export function FindingsTable({
  findings,
  onSelectFinding,
}: FindingsTableProps) {
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"severity" | "category" | "title">(
    "severity",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const severities = ["all", "critical", "high", "medium", "low", "info"];
  const categories = [
    "all",
    "security",
    "maintainability",
    "architecture",
    "testability",
    "frontend",
    "backend",
  ];

  // Severity ranking so "desc" surfaces the most serious findings first.
  const severityRank: Record<string, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1,
  };

  // Filtering logic
  const filteredFindings = findings.filter((f) => {
    const matchesSeverity =
      filterSeverity === "all" || f.severity.toLowerCase() === filterSeverity;
    const matchesCategory =
      filterCategory === "all" ||
      f.category.toLowerCase().includes(filterCategory);

    const searchText =
      `${f.title} ${f.filePath || ""} ${f.description || ""}`.toLowerCase();
    const matchesSearch = searchText.includes(searchQuery.toLowerCase());

    return matchesSeverity && matchesCategory && matchesSearch;
  });

  // Sorting logic applied to the real (filtered) findings.
  const sortedFindings = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredFindings].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "severity") {
        cmp =
          (severityRank[a.severity.toLowerCase()] ?? 0) -
          (severityRank[b.severity.toLowerCase()] ?? 0);
      } else if (sortBy === "category") {
        cmp = a.category.localeCompare(b.category);
      } else {
        cmp = a.title.localeCompare(b.title);
      }
      return cmp * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFindings, sortBy, sortDir]);

  return (
    <div className="space-y-4">
      {/* Filters Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-sm">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search findings title or file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-all"
          />
        </div>

        <div className="flex flex-wrap gap-4 items-center w-full md:w-auto">
          {/* Severity Filter */}
          <div className="flex flex-col w-full sm:w-auto">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              Severity
            </span>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring capitalize"
            >
              {severities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex flex-col w-full sm:w-auto">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              Category
            </span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring capitalize"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Control */}
          <div className="flex flex-col w-full sm:w-auto">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              Sort By
            </span>
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Sort findings by"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as "severity" | "category" | "title",
                  )
                }
                className="px-3 py-1.5 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring capitalize"
              >
                <option value="severity">Severity</option>
                <option value="category">Category</option>
                <option value="title">Title</option>
              </select>
              <button
                type="button"
                aria-label={`Toggle sort direction (currently ${sortDir})`}
                onClick={() =>
                  setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                }
                className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-bold rounded-sm border border-border bg-muted/40 text-foreground hover:bg-foreground hover:text-background transition-colors uppercase"
              >
                <ArrowDownUp className="w-3.5 h-3.5" />
                {sortDir}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Findings Table */}
      <div className="border border-border rounded-sm overflow-hidden bg-card">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                <th className="px-6 py-3.5">Severity</th>
                <th className="px-6 py-3.5">Category</th>
                <th className="px-6 py-3.5">Finding Details</th>
                <th className="px-6 py-3.5">File & Location</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm text-foreground">
              {filteredFindings.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-muted-foreground font-medium"
                  >
                    No findings matches the active filter criteria. Clear
                    filters to see all.
                  </td>
                </tr>
              ) : (
                sortedFindings.map((finding) => (
                  <tr
                    key={finding.id}
                    className="hover:bg-muted/50 transition-colors"
                  >
                    <td className="px-6 py-4.5 whitespace-nowrap">
                      <SeverityBadge severity={finding.severity} />
                      {finding.blocking && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-none text-[9px] font-mono font-bold bg-status-blocked/10 text-status-blocked border border-status-blocked">
                          BLOCKER
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4.5 whitespace-nowrap capitalize text-xs font-semibold tracking-wide">
                      {finding.category}
                    </td>
                    <td className="px-6 py-4.5">
                      <p className="font-semibold text-foreground">
                        {finding.title}
                      </p>
                      {finding.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {finding.description}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4.5 font-mono text-xs text-muted-foreground">
                      {finding.filePath ? (
                        <span>
                          {finding.filePath}
                          {finding.lineNumber ? `:${finding.lineNumber}` : ""}
                        </span>
                      ) : (
                        <span className="italic">Project-wide</span>
                      )}
                    </td>
                    <td className="px-6 py-4.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => onSelectFinding(finding)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-sm border border-border bg-muted/20 text-foreground hover:bg-foreground hover:text-background transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card Fallback */}
        <div className="md:hidden">
          {filteredFindings.length === 0 ? (
            <div className="px-6 py-12 text-center text-muted-foreground font-medium">
              No findings matches the active filter criteria. Clear filters to
              see all.
            </div>
          ) : (
            sortedFindings.map((finding) => (
              <div
                key={finding.id + "-card"}
                className="p-4 border-b border-border last:border-0 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={finding.severity} />
                  {finding.blocking && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-none text-[9px] font-mono font-bold bg-status-blocked/10 text-status-blocked border border-status-blocked">
                      BLOCKER
                    </span>
                  )}
                  <span className="capitalize text-xs font-semibold tracking-wide text-muted-foreground">
                    {finding.category}
                  </span>
                </div>
                <p className="font-semibold text-foreground text-sm">
                  {finding.title}
                </p>
                {finding.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {finding.description}
                  </p>
                )}
                <p className="font-mono text-xs text-muted-foreground">
                  {finding.filePath ? (
                    <span>
                      {finding.filePath}
                      {finding.lineNumber ? `:${finding.lineNumber}` : ""}
                    </span>
                  ) : (
                    <span className="italic">Project-wide</span>
                  )}
                </p>
                <button
                  onClick={() => onSelectFinding(finding)}
                  className="w-full justify-center inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-sm border border-border bg-muted/20 text-foreground hover:bg-foreground hover:text-background transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Inspect</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
