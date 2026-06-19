'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useProject, useUpdateProject, useDeleteProject } from '@/hooks/use-projects';
import { ArrowLeft, Save, Trash2, ShieldAlert, Loader2, AlertCircle, Check } from 'lucide-react';

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const { data: project, isLoading, isError, refetch } = useProject(projectId);
  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();

  const [name, setName] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [framework, setFramework] = useState('');
  const [minimumScore, setMinimumScore] = useState(80);
  const [larkChatId, setLarkChatId] = useState('');
  const [teamLeadLarkId, setTeamLeadLarkId] = useState('');

  const [msg, setMsg] = useState({ text: '', type: '' });

  useEffect(() => {
    if (project) {
      setName(project.name || '');
      setRepositoryUrl(project.repositoryUrl || '');
      setFramework(project.framework || '');
      setMinimumScore(project.minimumScore ?? 80);
      setLarkChatId(project.larkChatId || '');
      setTeamLeadLarkId(project.teamLeadLarkId || '');
    }
  }, [project]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ text: '', type: '' });
    try {
      await updateMutation.mutateAsync({
        id: projectId,
        data: {
          name,
          repositoryUrl: repositoryUrl || null,
          framework: framework || null,
          minimumScore: Number(minimumScore),
          larkChatId: larkChatId || null,
          teamLeadLarkId: teamLeadLarkId || null,
        },
      });
      setMsg({ text: 'Project settings updated successfully.', type: 'success' });
      refetch();
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to save settings.', type: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you absolutely sure you want to delete this project? This will remove all related scan logs.')) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(projectId);
      router.push('/projects');
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to delete project.', type: 'error' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
        <p className="text-sm font-mono text-gray-500">Retrieving configuration settings...</p>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="max-w-md mx-auto py-24 text-center space-y-4">
        <div className="p-4 bg-red-500/10 text-red-500 rounded-full w-fit mx-auto border border-red-500/20">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold">Failed to load configuration</h3>
        <p className="text-xs text-gray-500">The project was not found in the database.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Title */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/projects')}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors uppercase tracking-wider"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </button>

        <button
          onClick={handleDelete}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg border border-red-500/20 text-red-500 bg-red-500/5 hover:bg-red-500 hover:text-white transition-all"
        >
          <Trash2 className="w-4 h-4" />
          Delete Project
        </button>
      </div>

      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Project Settings</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Configure security triggers, minimum thresholds, and team notification preferences for <strong>{project.name}</strong>.
        </p>
      </div>

      {msg.text && (
        <div className={`p-4 rounded-lg text-xs font-bold flex gap-2 items-center ${
          msg.type === 'success' 
            ? 'bg-green-500/10 border border-green-500/20 text-green-500' 
            : 'bg-red-500/10 border border-red-500/20 text-red-500'
        }`}>
          {msg.type === 'success' ? <Check className="w-4.5 h-4.5" /> : <AlertCircle className="w-4.5 h-4.5" />}
          {msg.text}
        </div>
      )}

      {/* Configuration Form */}
      <div className="glass-card bg-white dark:bg-gray-900/35 border border-gray-200 dark:border-gray-800 p-8 rounded-lg">
        <form onSubmit={handleSave} className="space-y-6">
          
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 border-b border-gray-150 dark:border-gray-800 pb-2.5">
            General Properties
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                Project Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-55 dark:bg-gray-950 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                Framework / Environment
              </label>
              <input
                type="text"
                value={framework}
                onChange={(e) => setFramework(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-55 dark:bg-gray-950 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              Repository HTTPS URL
            </label>
            <input
              type="text"
              value={repositoryUrl}
              onChange={(e) => setRepositoryUrl(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-55 dark:bg-gray-950 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 border-b border-gray-150 dark:border-gray-800 pt-4 pb-2.5">
            Audit Quality Rules
          </h3>

          <div className="space-y-2.5">
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
              Minimum Pass Score Verdict (0 - 100)
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                min="0"
                max="100"
                value={minimumScore}
                onChange={(e) => setMinimumScore(Number(e.target.value))}
                className="w-24 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-55 dark:bg-gray-950 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              <span className="text-xs text-gray-500">
                Scans scoring below this value are flagged as Risky or Blocked automatically.
              </span>
            </div>
          </div>

          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 border-b border-gray-150 dark:border-gray-800 pt-4 pb-2.5">
            Lark Bot Chat Notifications
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                Lark Chat ID
              </label>
              <input
                type="text"
                placeholder="oc_xxxxxxxxxxxxxxxx"
                value={larkChatId}
                onChange={(e) => setLarkChatId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-55 dark:bg-gray-950 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                Team Lead Lark User ID
              </label>
              <input
                type="text"
                placeholder="ou_xxxxxxxxxxxxxxxx"
                value={teamLeadLarkId}
                onChange={(e) => setTeamLeadLarkId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-55 dark:bg-gray-950 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-800 pt-6 flex justify-end">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="inline-flex items-center gap-1.5 px-6 py-3 font-bold rounded-lg bg-cyan-500 text-gray-950 hover:bg-cyan-400 disabled:opacity-50 transition-all shadow-md shadow-cyan-500/20"
            >
              {updateMutation.isPending ? (
                <Loader2 className="w-4.5 h-4.5 animate-spin" />
              ) : (
                <Save className="w-4.5 h-4.5" />
              )}
              Save Settings
            </button>
          </div>

        </form>
      </div>

    </div>
  );
}
