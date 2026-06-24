"use client";

import React, { useState } from "react";
import { useRules, useToggleRule } from "@/hooks/use-rules";
import { CustomRulesManager } from "./custom-rules-manager";
import { SeverityBadge } from "@/components/severity-badge";
import { Rule } from "@slopshield/shared";
import { Skeleton } from "@/components/skeleton";
import { Search, RefreshCw } from "lucide-react";

interface DbRule extends Rule {
  id: string;
}

export default function RulesLibraryPage() {
  const { data: rulesData, isLoading, isError, refetch } = useRules();
  const rules = (rulesData || []) as DbRule[];
  const toggleRuleMutation = useToggleRule();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");

  const categories = [
    "all",
    "security",
    "maintainability",
    "architecture",
    "testability",
    "frontend",
    "backend",
  ];

  const handleToggleRule = async (id: string, currentlyEnabled: boolean) => {
    try {
      await toggleRuleMutation.mutateAsync({ id, enable: !currentlyEnabled });
    } catch (err) {
      console.error("Failed to toggle rule", err);
    }
  };

  const filteredRules = rules.filter((rule) => {
    const matchesCategory =
      filterCategory === "all" ||
      rule.category.toLowerCase().includes(filterCategory);
    const matchesSearch =
      rule.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.rule_id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            Quality Rules Library
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Configure custom static scanning policies and severity blockers.
          </p>
        </div>

        <button
          onClick={() => refetch()}
          className="p-2 text-muted-foreground hover:text-foreground rounded-sm hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Per-project custom rule engine */}
      <CustomRulesManager />

      {/* Filters Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-sm shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="w-4.5 h-4.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search rules"
            placeholder="Search rule ID or title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 transition-all"
          />
        </div>

        <div className="flex flex-col w-full sm:w-auto">
          <label
            htmlFor="rules-category-filter"
            className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1"
          >
            Category
          </label>
          <select
            id="rules-category-filter"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 capitalize"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Rules Grid list */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`rule-skeleton-${i}`}
              className="bg-card border border-border rounded-sm p-6 space-y-4"
            >
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : filteredRules.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          No rules match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredRules.map((rule) => {
            const appliesToArray = Array.isArray(rule.applies_to)
              ? rule.applies_to
              : [];
            const standardsArray = Array.isArray(rule.standards)
              ? rule.standards
              : [];

            return (
              <div
                key={rule.rule_id}
                className={`bg-card p-6 border rounded-sm transition-all flex flex-col justify-between space-y-4 shadow-sm ${
                  rule.enabled
                    ? "border-border"
                    : "border-dashed border-border opacity-50"
                }`}
              >
                <div>
                  {/* Top line status */}
                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono text-ring font-bold">
                        {rule.rule_id}
                      </span>
                      <h4 className="font-bold text-sm text-foreground">
                        {rule.title}
                      </h4>
                    </div>

                    {/* Enable Switch */}
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => handleToggleRule(rule.id, rule.enabled)}
                        className="w-8 h-4 rounded-full bg-border checked:bg-ring cursor-pointer appearance-none relative transition-all before:content-[''] before:absolute before:w-3 before:h-3 before:bg-white before:rounded-full before:top-[2px] before:left-[2px] checked:before:translate-x-4 before:transition-transform"
                      />
                    </div>
                  </div>

                  {/* Badges row */}
                  <div className="flex flex-wrap gap-2 items-center mt-3">
                    <SeverityBadge severity={rule.severity} />
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-muted border border-border capitalize">
                      {rule.category}
                    </span>
                    {rule.blocking && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20">
                        BLOCKER
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom line: targets and standards */}
                <div className="border-t border-border pt-3 flex items-center justify-between gap-4 text-[10px] font-mono text-muted-foreground">
                  <div className="truncate max-w-[150px]">
                    <span className="font-bold">Applies:</span>{" "}
                    {appliesToArray.join(", ") || "Any"}
                  </div>
                  <div className="truncate max-w-[150px] text-right">
                    <span className="font-bold">Refs:</span>{" "}
                    {standardsArray.join(", ") || "N/A"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
