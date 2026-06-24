"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  useDashboardSummary,
  useDashboardTrends,
  useDashboardTopIssues,
  useDashboardStandards,
} from "@/hooks/use-dashboard";
import { useProjects } from "@/hooks/use-projects";
import { Skeleton } from "@/components/skeleton";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Activity,
  Award,
  ShieldAlert,
  FileCheck,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Layers,
  ShieldCheck,
  PlusCircle,
  FolderOpen,
  BookOpen,
  ArrowRight,
} from "lucide-react";

export default function DashboardPage() {
  const [projectId, setProjectId] = useState<string>("");

  const { data: projects = [] } = useProjects();
  const {
    data: summary,
    isLoading: sumLoading,
    refetch: refetchSum,
  } = useDashboardSummary(projectId);
  const {
    data: trends = [],
    isLoading: trendsLoading,
    refetch: refetchTrends,
  } = useDashboardTrends(projectId);
  const {
    data: topIssues = [],
    isLoading: issuesLoading,
    refetch: refetchIssues,
  } = useDashboardTopIssues(projectId);
  const {
    data: standards = [],
    isLoading: stdLoading,
    refetch: refetchStd,
  } = useDashboardStandards(projectId);

  const handleRefresh = () => {
    refetchSum();
    refetchTrends();
    refetchIssues();
    refetchStd();
  };

  const isRefreshing =
    sumLoading || trendsLoading || issuesLoading || stdLoading;

  // Professional, theme-stable chart palette (readable on both light and dark).
  const CHART = {
    accent: "var(--color-ring)", // score trend — brand accent, adapts to theme
    issues: "#f59e0b", // amber-500 — quality violations
    standards: "#8b5cf6", // violet-500 — matches the Layers icon
  };

  // Verdict slices mapped to their semantic meaning.
  const VERDICT_COLORS: Record<string, string> = {
    Passed: "#10b981", // emerald-500
    Warnings: "#f59e0b", // amber-500
    Blocked: "#ef4444", // red-500
  };

  const quickActions = [
    {
      name: "Run New Scan",
      desc: "Audit a codebase for slop",
      href: "/scans/new",
      icon: PlusCircle,
      color: "text-cyan-600 dark:text-cyan-400",
      bg: "bg-cyan-500/10",
    },
    {
      name: "View Projects",
      desc: "Manage connected repositories",
      href: "/projects",
      icon: FolderOpen,
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-500/10",
    },
    {
      name: "Rules Library",
      desc: "Browse quality rule sets",
      href: "/rules",
      icon: BookOpen,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
    },
  ];

  const stats = [
    {
      name: "Total Audits Run",
      value: summary?.totalScans ?? 0,
      desc: "Cumulative code scan executions",
      icon: Activity,
      color: "text-cyan-500",
      bg: "bg-cyan-500/10",
    },
    {
      name: "Average Quality Score",
      value:
        summary && typeof summary.averageScore === "number"
          ? `${Math.round(summary.averageScore)}/100`
          : "N/A",
      desc: "Average codebase score",
      icon: Award,
      color: "text-green-500",
      bg: "bg-green-500/10",
    },
    {
      name: "Blocked Merges",
      value: summary?.blockedScans ?? 0,
      desc: "Build blocks due to critical rule violations",
      icon: ShieldAlert,
      color: "text-red-500",
      bg: "bg-red-500/10",
    },
    {
      name: "Clean Builds",
      value: summary?.passedScans ?? 0,
      desc: "Build runs passing all quality boundaries",
      icon: FileCheck,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
  ];

  // Helper to safely parse numbers
  const safeTrends = trends.map((t) => ({
    ...t,
    score: Number(t.score ?? 0),
  }));

  const safeIssues = topIssues.map((i) => ({
    name: i.title,
    count: Number(i.count ?? 0),
  }));

  const safeStandards = standards.map((s) => ({
    name: s.standard,
    violations: Number(s.count ?? 0),
  }));

  const pieData = [
    { name: "Passed", value: summary?.passedScans ?? 0 },
    { name: "Warnings", value: summary?.warningScans ?? 0 },
    { name: "Blocked", value: summary?.blockedScans ?? 0 },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-8">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-border pb-6">
        <div>
          <h2 className="font-display text-3xl font-bold uppercase tracking-wider text-foreground">
            Analytics Dashboard
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Visual metrics on codebase quality scores, blocker trends, and
            compliance tracking.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Project Select */}
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Filter dashboard by project"
            className="flex-1 sm:flex-none px-3.5 py-2 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus:border-ring"
          >
            <option value="">All Projects Summary</option>
            {projects.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh dashboard data"
            className="p-2 text-muted-foreground hover:text-foreground rounded-sm border border-border bg-muted/20 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* KPI Stats Row */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.name}
              className="border border-border bg-card p-6 rounded-sm flex items-center justify-between gap-4 shadow-sm hover:shadow-md hover:border-foreground/20 transition-shadow"
            >
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest block">
                  {stat.name}
                </span>
                <p className="font-display text-4xl font-extrabold text-foreground tracking-tight mt-1">
                  {sumLoading ? (
                    <Skeleton className="h-9 w-20" />
                  ) : (
                    stat.value
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                  {stat.desc}
                </p>
              </div>
              <div
                className={`p-3 rounded-sm shrink-0 ${stat.bg} ${stat.color}`}
              >
                <Icon className="w-5 h-5" />
              </div>
            </div>
          );
        })}
      </section>

      {/* Quick Actions */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.name}
              href={action.href}
              className="group border border-border bg-card p-5 rounded-sm flex items-center gap-4 shadow-sm hover:shadow-md hover:border-foreground/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className={`p-3 rounded-sm shrink-0 ${action.bg} ${action.color}`}>
                <Icon className="w-5 h-5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  {action.name}
                </span>
                <span className="block text-xs text-muted-foreground truncate">
                  {action.desc}
                </span>
              </span>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all shrink-0" />
            </Link>
          );
        })}
      </section>

      {/* Charts Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Quality Score Trend Over Time */}
        <div className="lg:col-span-2 border border-border bg-card p-6 rounded-sm space-y-4 shadow-sm">
          <h3 className="font-display text-lg font-bold uppercase tracking-wider text-foreground flex gap-2 items-center">
            <TrendingUp className="w-4 h-4 text-ring" />
            Quality Score Trend Over Time
          </h3>

          <div className="h-64 w-full">
            {trendsLoading ? (
              <Skeleton className="h-full w-full" />
            ) : safeTrends.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No scan logs recorded to plot trend data.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={safeTrends}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                  />
                  <XAxis
                    dataKey="date"
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-muted)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-foreground)",
                      borderRadius: "0.125rem",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={CHART.accent}
                    strokeWidth={2}
                    dot={{ fill: CHART.accent, r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Scan Status Distribution */}
        <div className="border border-border bg-card p-6 rounded-sm space-y-4 shadow-sm">
          <h3 className="font-display text-lg font-bold uppercase tracking-wider text-foreground flex gap-2 items-center">
            <ShieldCheck className="w-4 h-4 text-status-passed" />
            Build Scan Verdicts
          </h3>

          <div className="h-64 w-full flex items-center justify-center">
            {sumLoading ? (
              <Skeleton className="h-full w-full" />
            ) : pieData.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No scans executed.
              </span>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={VERDICT_COLORS[entry.name] ?? CHART.accent}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-muted)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-foreground)",
                      borderRadius: "0.125rem",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* Row 2 Charts */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Top 5 Quality Issues */}
        <div className="border border-border bg-card p-6 rounded-sm space-y-4 shadow-sm">
          <h3 className="font-display text-lg font-bold uppercase tracking-wider text-foreground flex gap-2 items-center">
            <AlertTriangle className="w-4 h-4 text-severity-high" />
            Most Common Quality Violations
          </h3>

          <div className="h-64 w-full">
            {issuesLoading ? (
              <Skeleton className="h-full w-full" />
            ) : safeIssues.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No quality issues recorded. Clean code!
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={safeIssues}
                  margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                  />
                  <XAxis
                    dataKey="name"
                    stroke="var(--color-muted-foreground)"
                    fontSize={9}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-muted)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-foreground)",
                      borderRadius: "0.125rem",
                    }}
                  />
                  <Bar
                    dataKey="count"
                    fill={CHART.issues}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Mapped Standards Violations */}
        <div className="border border-border bg-card p-6 rounded-sm space-y-4 shadow-sm">
          <h3 className="font-display text-lg font-bold uppercase tracking-wider text-foreground flex gap-2 items-center">
            <Layers className="w-4 h-4 text-purple-500" />
            Compliance Framework Violations
          </h3>

          <div className="h-64 w-full">
            {stdLoading ? (
              <Skeleton className="h-full w-full" />
            ) : safeStandards.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No compliance violations found.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={safeStandards}
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                  />
                  <XAxis
                    type="number"
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="var(--color-muted-foreground)"
                    fontSize={10}
                    tickLine={false}
                    width={80}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-muted)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-foreground)",
                      borderRadius: "0.125rem",
                    }}
                  />
                  <Bar
                    dataKey="violations"
                    fill={CHART.standards}
                    radius={[0, 2, 2, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
