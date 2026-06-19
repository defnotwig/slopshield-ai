'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Editor from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import { useProjects } from '@/hooks/use-projects';
import { useCreateScan } from '@/hooks/use-scans';
import { Terminal, Upload, Link2, Code, ShieldAlert, AlertTriangle, Play, HelpCircle } from 'lucide-react';

export default function NewScanPage() {
  const router = useRouter();
  const { theme } = useTheme();
  
  const { data: projects = [] } = useProjects();
  const createScanMutation = useCreateScan();

  const [activeTab, setActiveTab] = useState<'paste' | 'upload' | 'repo' | 'demo'>('paste');
  const [projectId, setProjectId] = useState<string>('');
  const [scanMode, setScanMode] = useState<string>('full');

  // Input states
  const [sourceContent, setSourceContent] = useState<string>('// Paste your code here...\n');
  const [file, setFile] = useState<File | null>(null);
  const [sourceRef, setSourceRef] = useState<string>('');
  const [demoSampleId, setDemoSampleId] = useState<string>('bad-frontend');

  const [err, setErr] = useState<string>('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleRunScan = async () => {
    setErr('');
    try {
      let body: any;

      if (activeTab === 'paste') {
        if (!sourceContent.trim() || sourceContent === '// Paste your code here...\n') {
          throw new Error('Please paste some code content before starting.');
        }
        body = {
          projectId: projectId || undefined,
          sourceType: 'paste',
          sourceContent,
          scanMode,
        };
      } else if (activeTab === 'upload') {
        if (!file) {
          throw new Error('Please select a ZIP file to upload.');
        }
        const formData = new FormData();
        formData.append('sourceType', 'upload');
        formData.append('file', file);
        formData.append('scanMode', scanMode);
        if (projectId) {
          formData.append('projectId', projectId);
        }
        body = formData;
      } else if (activeTab === 'repo') {
        if (!sourceRef.trim()) {
          throw new Error('Please provide a repository URL.');
        }
        body = {
          projectId: projectId || undefined,
          sourceType: 'git',
          sourceRef,
          scanMode,
        };
      } else if (activeTab === 'demo') {
        body = {
          projectId: projectId || undefined,
          sourceType: 'demo-sample',
          demoSampleId,
          scanMode,
        };
      }

      const scanJob = await createScanMutation.mutateAsync(body);
      router.push(`/scans/${scanJob.id}/progress`);
    } catch (e: any) {
      setErr(e.message || 'Failed to start scan.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Title Header */}
      <div className="border-b border-border pb-6">
        <h2 className="font-display text-3xl font-bold uppercase tracking-wider text-foreground">Run New Code Scan</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Audits your source codebase and calculates the overall SlopShield quality report.
        </p>
      </div>

      {err && (
        <div className="p-3.5 rounded-sm bg-destructive/10 border border-destructive/20 text-xs font-semibold text-destructive animate-shake">
          {err}
        </div>
      )}

      {/* Main Form Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Side: Input selectors & options */}
        <div className="lg:col-span-2 space-y-6">
          <div className="border border-border bg-card rounded-sm overflow-hidden flex flex-col h-[500px]">
            {/* Form tabs */}
            <div className="flex border-b border-border bg-muted/30">
              <button
                onClick={() => setActiveTab('paste')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all ${
                  activeTab === 'paste'
                    ? 'border-ring text-foreground bg-muted/60'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Code className="w-4 h-4" />
                Paste Code
              </button>
              <button
                onClick={() => setActiveTab('upload')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all ${
                  activeTab === 'upload'
                    ? 'border-ring text-foreground bg-muted/60'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Upload className="w-4 h-4" />
                ZIP Upload
              </button>
              <button
                onClick={() => setActiveTab('repo')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all ${
                  activeTab === 'repo'
                    ? 'border-ring text-foreground bg-muted/60'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Link2 className="w-4 h-4" />
                Git Repo
              </button>
              <button
                onClick={() => setActiveTab('demo')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all ${
                  activeTab === 'demo'
                    ? 'border-ring text-foreground bg-muted/60'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Terminal className="w-4 h-4" />
                Demo
              </button>
            </div>

            {/* Tab Panels */}
            <div className="flex-1 p-6 overflow-y-auto">
              
              {/* Tab: Paste Code */}
              {activeTab === 'paste' && (
                <div className="h-full flex flex-col space-y-3">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Paste Source Code</span>
                  <div className="flex-1 border border-border rounded-sm overflow-hidden min-h-[300px]">
                    <Editor
                      height="100%"
                      defaultLanguage="typescript"
                      value={sourceContent}
                      onChange={(val) => setSourceContent(val || '')}
                      theme={theme === 'dark' ? 'vs-dark' : 'light'}
                      options={{
                        fontSize: 13,
                        minimap: { enabled: false },
                        wordWrap: 'on',
                        automaticLayout: true,
                        fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, Courier New, monospace',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Tab: ZIP Upload */}
              {activeTab === 'upload' && (
                <div className="h-full flex flex-col justify-center items-center space-y-4 border border-dashed border-border rounded-sm p-8 bg-muted/10 hover:border-ring/30 transition-colors">
                  <div className="p-4 bg-muted border border-border rounded-sm text-foreground">
                    <Upload className="w-6 h-6 animate-pulse" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-semibold">Click to select files or drag-and-drop</p>
                    <p className="text-xs text-muted-foreground">ZIP archive containing frontend or backend codebase (max 50MB)</p>
                  </div>
                  <input
                    type="file"
                    accept=".zip"
                    onChange={handleFileChange}
                    className="block text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-sm file:border file:border-border file:text-xs file:font-semibold file:bg-foreground file:text-background file:hover:bg-foreground/90 file:cursor-pointer"
                  />
                  {file && (
                    <div className="p-2.5 rounded-sm border border-ring/25 bg-ring/5 text-xs font-mono text-foreground">
                      Selected: {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Git Repo */}
              {activeTab === 'repo' && (
                <div className="space-y-4 max-w-md mx-auto">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">Repository HTTPs URL</span>
                  <div className="relative">
                    <Link2 className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="https://github.com/org/repo.git"
                      value={sourceRef}
                      onChange={(e) => setSourceRef(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-all"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Note: Public repositories only for local sandbox access. Private repositories require git SSH config variables initialized in .env.
                  </p>
                </div>
              )}

              {/* Tab: Demo Sample */}
              {activeTab === 'demo' && (
                <div className="space-y-4">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">Select Intentionally Sloppy Demo Sample</span>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Sample 1 */}
                    <div
                      onClick={() => setDemoSampleId('bad-frontend')}
                      className={`p-5 border rounded-sm cursor-pointer transition-all flex flex-col justify-between ${
                        demoSampleId === 'bad-frontend'
                          ? 'border-ring bg-ring/5 text-foreground'
                          : 'border-border bg-muted/10 hover:border-muted-foreground/35'
                      }`}
                    >
                      <div>
                        <h4 className="font-bold text-sm text-foreground">Sloppy Frontend Dashboard</h4>
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                          Intentionally messy React dashboard: God component (500+ lines), mixes concerns, clickable divs with no a11y, hardcoded API paths, dangerouslySetInnerHTML, side-effect loops, and zero tests.
                        </p>
                      </div>
                      <span className="text-[9px] mt-4 font-mono uppercase bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 rounded-sm w-fit">
                        Frontend Slop
                      </span>
                    </div>

                    {/* Sample 2 */}
                    <div
                      onClick={() => setDemoSampleId('bad-backend')}
                      className={`p-5 border rounded-sm cursor-pointer transition-all flex flex-col justify-between ${
                        demoSampleId === 'bad-backend'
                          ? 'border-ring bg-ring/5 text-foreground'
                          : 'border-border bg-muted/10 hover:border-muted-foreground/35'
                      }`}
                    >
                      <div>
                        <h4 className="font-bold text-sm text-foreground">Sloppy Backend Controller</h4>
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                          Messy NestJS Controller: Raw SQL concatenation (SQL injection vulnerable), hardcoded root database password secrets, missing DTO request validators, no exception filters, and zero test suites.
                        </p>
                      </div>
                      <span className="text-[9px] mt-4 font-mono uppercase bg-severity-high/10 text-severity-high border border-severity-high/20 px-2 py-0.5 rounded-sm w-fit">
                        Backend Slop
                      </span>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Right Side: Configuration Sidebar */}
        <div className="space-y-6">
          <div className="border border-border bg-card p-6 rounded-sm space-y-6">
            <h3 className="font-display text-lg font-bold uppercase tracking-wider text-foreground border-b border-border pb-3">
              Scan Settings
            </h3>

            {/* Project Select */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">
                Assign to Project
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring"
              >
                <option value="">None (Ad-Hoc Scan)</option>
                {projects.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Scan Mode Select */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">
                Scan Profile Mode
              </label>
              <select
                value={scanMode}
                onChange={(e) => setScanMode(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring"
              >
                <option value="full">Full Audit Scan</option>
                <option value="fast">Fast Static Checks Only</option>
                <option value="security-only">Security Scan Profile</option>
                <option value="frontend-only">Frontend Only Profile</option>
                <option value="backend-only">Backend Only Profile</option>
              </select>
            </div>

            {/* Warning Cards depending on selection */}
            {activeTab === 'demo' && (
              <div className="p-3 rounded-sm bg-severity-high/10 border border-severity-high/20 flex gap-2 items-start text-xs text-severity-high">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>Demo mode clones pre-defined messy source files into a clean scan context. Good for testing scoring engines.</p>
              </div>
            )}

            <button
              onClick={handleRunScan}
              disabled={createScanMutation.isPending}
              className="w-full py-3.5 font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 shrink-0" />
              {createScanMutation.isPending ? 'Queuing Pipeline...' : 'Start Audit Scan'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
