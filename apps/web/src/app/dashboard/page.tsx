'use client';

import React, { useState } from 'react';
import { 
  useDashboardSummary, 
  useDashboardTrends, 
  useDashboardTopIssues, 
  useDashboardStandards 
} from '@/hooks/use-dashboard';
import { useProjects } from '@/hooks/use-projects';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell 
} from 'recharts';
import { 
  Activity, Award, ShieldAlert, FileCheck, RefreshCw, 
  TrendingUp, AlertTriangle, Layers, ShieldCheck 
} from 'lucide-react';

export default function DashboardPage() {
  const [projectId, setProjectId] = useState<string>('');

  const { data: projects = [] } = useProjects();
  const { data: summary, isLoading: sumLoading, refetch: refetchSum } = useDashboardSummary(projectId);
  const { data: trends = [], isLoading: trendsLoading, refetch: refetchTrends } = useDashboardTrends(projectId);
  const { data: topIssues = [], isLoading: issuesLoading, refetch: refetchIssues } = useDashboardTopIssues(projectId);
  const { data: standards = [], isLoading: stdLoading, refetch: refetchStd } = useDashboardStandards(projectId);

  const handleRefresh = () => {
    refetchSum();
    refetchTrends();
    refetchIssues();
    refetchStd();
  };

  const COLORS = ['#00d4ff', '#00ff88', '#ffaa00', '#ff6b35', '#a78bfa', '#ff3366'];

  const stats = [
    {
      name: 'Total Audits Run',
      value: summary?.totalScans ?? 0,
      desc: 'Cumulative code scan executions',
      icon: Activity,
      color: 'text-cyan-500',
      bg: 'bg-cyan-500/10',
    },
    {
      name: 'Average Quality Score',
      value: summary?.averageScore !== null ? `${Math.round(summary?.averageScore)}/100` : 'N/A',
      desc: 'Average codebase score',
      icon: Award,
      color: 'text-green-500',
      bg: 'bg-green-500/10',
    },
    {
      name: 'Blocked Merges',
      value: summary?.blockedScans ?? 0,
      desc: 'Build blocks due to critical rule violations',
      icon: ShieldAlert,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
    },
    {
      name: 'Clean Builds',
      value: summary?.passedScans ?? 0,
      desc: 'Build runs passing all quality boundaries',
      icon: FileCheck,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
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
    { name: 'Passed', value: summary?.passedScans ?? 0 },
    { name: 'Warnings', value: summary?.warningScans ?? 0 },
    { name: 'Blocked', value: summary?.blockedScans ?? 0 },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-8">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between border-b border-border pb-6">
        <div>
          <h2 className="font-display text-3xl font-bold uppercase tracking-wider text-foreground">Analytics Dashboard</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Visual metrics on codebase quality scores, blocker trends, and compliance tracking.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Project Select */}
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="px-3.5 py-2 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring"
          >
            <option value="">All Projects Summary</option>
            {projects.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <button
            onClick={handleRefresh}
            className="p-2 text-muted-foreground hover:text-foreground rounded-sm border border-border bg-muted/20 hover:bg-muted transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KPI Stats Row */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="border border-border bg-card p-6 rounded-sm flex items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest block">{stat.name}</span>
                <p className="font-display text-4xl font-extrabold text-foreground tracking-tight mt-1">{stat.value}</p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{stat.desc}</p>
              </div>
              <div className={`p-3 rounded-sm border border-border/10 bg-muted shrink-0 ${stat.color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          );
        })}
      </section>

      {/* Charts Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Quality Score Trend Over Time */}
        <div className="lg:col-span-2 border border-border bg-card p-6 rounded-sm space-y-4">
          <h3 className="font-display text-lg font-bold uppercase tracking-wider text-foreground flex gap-2 items-center">
            <TrendingUp className="w-4 h-4 text-ring" />
            Quality Score Trend Over Time
          </h3>

          <div className="h-64 w-full">
            {trendsLoading ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-muted-foreground">
                Fetching trend series...
              </div>
            ) : safeTrends.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No scan logs recorded to plot trend data.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={safeTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} />
                  <YAxis domain={[0, 100]} stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'var(--color-muted)', 
                      borderColor: 'var(--color-border)', 
                      color: 'var(--color-foreground)',
                      borderRadius: '0.125rem'
                    }} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="score" 
                    stroke="var(--color-severity-low)" 
                    strokeWidth={2} 
                    dot={{ fill: 'var(--color-severity-low)', r: 3 }} 
                    activeDot={{ r: 5 }} 
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Scan Status Distribution */}
        <div className="border border-border bg-card p-6 rounded-sm space-y-4">
          <h3 className="font-display text-lg font-bold uppercase tracking-wider text-foreground flex gap-2 items-center">
            <ShieldCheck className="w-4 h-4 text-status-passed" />
            Build Scan Verdicts
          </h3>

          <div className="h-64 w-full flex items-center justify-center">
            {sumLoading ? (
              <span className="text-xs font-mono text-muted-foreground">Loading distribution...</span>
            ) : pieData.length === 0 ? (
              <span className="text-xs text-muted-foreground">No scans executed.</span>
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
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'var(--color-muted)', 
                      borderColor: 'var(--color-border)', 
                      color: 'var(--color-foreground)',
                      borderRadius: '0.125rem'
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
        <div className="border border-border bg-card p-6 rounded-sm space-y-4">
          <h3 className="font-display text-lg font-bold uppercase tracking-wider text-foreground flex gap-2 items-center">
            <AlertTriangle className="w-4 h-4 text-severity-high" />
            Most Common Quality Violations
          </h3>

          <div className="h-64 w-full">
            {issuesLoading ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-muted-foreground">
                Fetching issues...
              </div>
            ) : safeIssues.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No quality issues recorded. Clean code!
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={safeIssues} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={9} tickLine={false} interval={0} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'var(--color-muted)', 
                      borderColor: 'var(--color-border)', 
                      color: 'var(--color-foreground)',
                      borderRadius: '0.125rem'
                    }} 
                  />
                  <Bar dataKey="count" fill="var(--color-severity-high)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Mapped Standards Violations */}
        <div className="border border-border bg-card p-6 rounded-sm space-y-4">
          <h3 className="font-display text-lg font-bold uppercase tracking-wider text-foreground flex gap-2 items-center">
            <Layers className="w-4 h-4 text-purple-500" />
            Compliance Framework Violations
          </h3>

          <div className="h-64 w-full">
            {stdLoading ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-muted-foreground">
                Fetching standards...
              </div>
            ) : safeStandards.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No compliance violations found.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={safeStandards} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} />
                  <YAxis type="category" dataKey="name" stroke="var(--color-muted-foreground)" fontSize={10} tickLine={false} width={80} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'var(--color-muted)', 
                      borderColor: 'var(--color-border)', 
                      color: 'var(--color-foreground)',
                      borderRadius: '0.125rem'
                    }} 
                  />
                  <Bar dataKey="violations" fill="var(--color-chart-5)" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

      </section>
    </div>
  );
}
