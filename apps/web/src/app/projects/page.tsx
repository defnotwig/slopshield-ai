'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useProjects, useCreateProject } from '@/hooks/use-projects';
import { FolderOpen, Settings, ListCollapse, Plus, AlertCircle, Loader2 } from 'lucide-react';

export default function ProjectsListPage() {
  const { data: projects = [], isLoading, isError, refetch } = useProjects();
  const createProjectMutation = useCreateProject();

  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [framework, setFramework] = useState('React / Next.js');
  const [minimumScore, setMinimumScore] = useState(80);
  const [err, setErr] = useState('');

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!name) {
      setErr('Project name is required.');
      return;
    }

    try {
      await createProjectMutation.mutateAsync({
        name,
        repositoryUrl: repositoryUrl || null,
        framework,
        minimumScore: Number(minimumScore),
      });
      setName('');
      setRepositoryUrl('');
      setShowAddForm(false);
      refetch();
    } catch (e: any) {
      setErr(e.message || 'Failed to create project.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Monitored Projects</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Manage target codebases, configure quality thresholds, and trigger automated builds.
          </p>
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold rounded-lg bg-cyan-500 text-gray-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
        >
          <Plus className="w-4.5 h-4.5" />
          Add Project
        </button>
      </div>

      {/* Add Project Form (Dropdown) */}
      {showAddForm && (
        <div className="glass-card bg-white dark:bg-gray-900/35 border border-gray-200 dark:border-gray-800 p-6 rounded-lg max-w-xl animate-fade-in-up">
          <h3 className="font-bold text-sm mb-4 border-b border-gray-100 dark:border-gray-850 pb-2.5">
            Register New Codebase
          </h3>

          {err && (
            <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-bold text-red-500">
              {err}
            </div>
          )}

          <form onSubmit={handleAddProject} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                  Project Name *
                </label>
                <input
                  type="text"
                  placeholder="My API Service"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-850 bg-gray-55 dark:bg-gray-905 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                  Framework / Language
                </label>
                <input
                  type="text"
                  placeholder="NestJS / TypeScript"
                  value={framework}
                  onChange={(e) => setFramework(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-850 bg-gray-55 dark:bg-gray-905 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                Repository HTTPS URL
              </label>
              <input
                type="text"
                placeholder="https://github.com/my-org/my-repo.git"
                value={repositoryUrl}
                onChange={(e) => setRepositoryUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-850 bg-gray-55 dark:bg-gray-905 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                Min Pass Score Verdict (0 - 100)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={minimumScore}
                onChange={(e) => setMinimumScore(Number(e.target.value))}
                className="w-24 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-850 bg-gray-55 dark:bg-gray-905 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div className="flex gap-4 justify-end pt-3">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createProjectMutation.isPending}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-cyan-500 text-gray-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                Create Project
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Grid of Projects */}
      {isLoading ? (
        <div className="p-12 text-center text-sm font-mono text-gray-500">
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="p-12 text-center text-sm text-gray-500">
          No projects registered. Click &quot;Add Project&quot; above to setup your first monitored codebase!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p: any) => (
            <div key={p.id} className="glass-card bg-white dark:bg-gray-900/25 border border-gray-200 dark:border-gray-800 p-6 rounded-lg flex flex-col justify-between space-y-4 hover:scale-[1.01] transition-transform duration-200">
              <div className="space-y-2">
                <div className="flex justify-between items-start gap-4">
                  <div className="p-2.5 bg-cyan-500/10 rounded-lg text-cyan-500 border border-cyan-500/10">
                    <FolderOpen className="w-5.5 h-5.5" />
                  </div>

                  <Link 
                    href={`/projects/${p.id}/settings`}
                    className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-900 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Settings className="w-4.5 h-4.5" />
                  </Link>
                </div>

                <div>
                  <h4 className="font-bold text-sm text-gray-800 dark:text-gray-150">
                    {p.name}
                  </h4>
                  {p.framework && (
                    <span className="text-[10px] text-gray-500 font-mono mt-0.5 block">
                      Framework: {p.framework}
                    </span>
                  )}
                </div>
              </div>

              {/* Status and Action bar */}
              <div className="border-t border-gray-250 dark:border-gray-800 pt-4 flex items-center justify-between text-xs font-semibold text-gray-500">
                <span>Pass Threshold: {p.minimumScore}/100</span>
                <Link
                  href={`/scans?projectId=${p.id}`}
                  className="text-cyan-550 hover:text-cyan-400 hover:underline flex gap-1 items-center"
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
