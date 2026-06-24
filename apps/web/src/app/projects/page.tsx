"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useProjects, useCreateProject } from "@/hooks/use-projects";
import { Skeleton } from "@/components/skeleton";
import { FolderOpen, Settings, ListCollapse, Plus } from "lucide-react";

export default function ProjectsListPage() {
  const { data: projects = [], isLoading, isError, refetch } = useProjects();
  const createProjectMutation = useCreateProject();

  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [framework, setFramework] = useState("React / Next.js");
  const [minimumScore, setMinimumScore] = useState(80);
  const [err, setErr] = useState("");

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!name) {
      setErr("Project name is required.");
      return;
    }

    try {
      await createProjectMutation.mutateAsync({
        name,
        repositoryUrl: repositoryUrl || null,
        framework,
        minimumScore: Number(minimumScore),
      });
      setName("");
      setRepositoryUrl("");
      setShowAddForm(false);
      refetch();
    } catch (e: any) {
      setErr(e.message || "Failed to create project.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            Monitored Projects
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Manage target codebases, configure quality thresholds, and trigger
            automated builds.
          </p>
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 w-full sm:w-auto justify-center"
        >
          <Plus className="w-4.5 h-4.5" />
          Add Project
        </button>
      </div>

      {/* Add Project Form (Dropdown) */}
      {showAddForm && (
        <div className="bg-card border border-border shadow-sm p-6 rounded-sm max-w-xl animate-fade-in-up">
          <h3 className="font-bold text-sm mb-4 border-b border-border pb-2.5">
            Register New Codebase
          </h3>

          {err && (
            <div className="p-3 mb-4 rounded-sm bg-destructive/10 border border-destructive/20 text-xs font-bold text-destructive">
              {err}
            </div>
          )}

          <form onSubmit={handleAddProject} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label
                  htmlFor="project-name"
                  className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
                >
                  Project Name *
                </label>
                <input
                  id="project-name"
                  type="text"
                  placeholder="My API Service"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  required
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="project-framework"
                  className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
                >
                  Framework / Language
                </label>
                <input
                  id="project-framework"
                  type="text"
                  placeholder="NestJS / TypeScript"
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="project-repository-url"
                className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
              >
                Repository HTTPS URL
              </label>
              <input
                id="project-repository-url"
                type="text"
                placeholder="https://github.com/my-org/my-repo.git"
                value={repositoryUrl}
                onChange={(e) => setRepositoryUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="project-minimum-score"
                className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
              >
                Min Pass Score Verdict (0 - 100)
              </label>
              <input
                id="project-minimum-score"
                type="number"
                min="0"
                max="100"
                value={minimumScore}
                onChange={(e) => setMinimumScore(Number(e.target.value))}
                className="w-24 px-3 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>

            <div className="flex gap-4 justify-end pt-3">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-xs font-semibold rounded-sm border border-border bg-transparent text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createProjectMutation.isPending}
                className="px-4 py-2 text-xs font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Create Project
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Grid of Projects */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`project-skeleton-${i}`}
              className="bg-card border border-border rounded-sm p-6 space-y-4"
            >
              <Skeleton className="h-10 w-10" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          No projects registered. Click &quot;Add Project&quot; above to setup
          your first monitored codebase!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p: any) => (
            <div
              key={p.id}
              className="bg-card border border-border shadow-sm hover:shadow-md hover:border-foreground/20 p-6 rounded-sm flex flex-col justify-between space-y-4 transition-shadow"
            >
              <div className="space-y-2">
                <div className="flex justify-between items-start gap-4">
                  <div className="p-2.5 bg-cyan-500/10 rounded-sm text-cyan-500 border border-cyan-500/10">
                    <FolderOpen className="w-5.5 h-5.5" />
                  </div>

                  <Link
                    href={`/projects/${p.id}/settings`}
                    className="p-1.5 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Settings className="w-4.5 h-4.5" />
                  </Link>
                </div>

                <div>
                  <h4 className="font-bold text-sm text-foreground">
                    {p.name}
                  </h4>
                  {p.framework && (
                    <span className="text-[10px] text-muted-foreground font-mono mt-0.5 block">
                      Framework: {p.framework}
                    </span>
                  )}
                </div>
              </div>

              {/* Status and Action bar */}
              <div className="border-t border-border pt-4 flex items-center justify-between text-xs font-semibold text-muted-foreground">
                <span>Pass Threshold: {p.minimumScore}/100</span>
                <Link
                  href={`/scans?projectId=${p.id}`}
                  className="text-ring hover:text-ring/80 hover:underline flex gap-1 items-center"
                >
                  View Scans
                  <ListCollapse className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
