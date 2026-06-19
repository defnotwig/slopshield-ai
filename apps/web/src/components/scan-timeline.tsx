import React from 'react';
import { Check, Loader2, AlertTriangle } from 'lucide-react';

interface ScanTimelineProps {
  currentStage: string;
  percentage: number;
  message: string;
}

export function ScanTimeline({ currentStage, percentage, message }: ScanTimelineProps) {
  const stages = [
    { key: 'fetching', label: 'File Ingestion & Indexing', desc: 'Copying code files into secure sandbox context.' },
    { key: 'classifying', label: 'File Classification', desc: 'Detecting frontend, backend, test, and config files.' },
    { key: 'scanning', label: 'Static Security Scanning', desc: 'Running ESLint, TypeScript and secret scanners.' },
    { key: 'ai-reviewing', label: 'Gemini Codebase Review', desc: 'Analyzing codebase with Gemini 2.5 Pro.' },
    { key: 'scoring', label: 'SlopShield Scoring', desc: 'Calculating overall score and category breakdown.' },
    { key: 'reporting', label: 'Report Generation', desc: 'Assembling findings and standard references.' },
    { key: 'notifying', label: 'Lark Notification', desc: 'Posting interactive card summary to team chat.' },
    { key: 'completed', label: 'Scan Completed', desc: 'Pipeline finished successfully.' },
  ];

  // Helper to determine stage status: 'completed' | 'active' | 'pending' | 'failed'
  const getStageStatus = (stageKey: string) => {
    if (currentStage === 'failed') {
      if (stageKey === currentStage) return 'failed';
    }

    const currentIndex = stages.findIndex((s) => s.key === currentStage);
    const targetIndex = stages.findIndex((s) => s.key === stageKey);

    if (currentStage === 'failed' && targetIndex > currentIndex) {
      return 'pending';
    }
    if (currentStage === 'failed' && targetIndex < currentIndex) {
      return 'completed';
    }

    if (targetIndex < currentIndex) return 'completed';
    if (targetIndex === currentIndex) return 'active';
    return 'pending';
  };

  return (
    <div className="space-y-8">
      {/* Overall Progress Bar */}
      <div className="border border-border p-6 bg-card rounded-sm">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Pipeline Progress
          </span>
          <span className="font-display text-2xl font-bold text-ring tracking-tight">
            {percentage}%
          </span>
        </div>
        <div className="h-2 w-full bg-muted border border-border rounded-none overflow-hidden">
          <div 
            className="h-full bg-ring transition-all duration-500 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
        {message && (
          <p className="text-[11px] text-muted-foreground mt-3 font-mono">
            &gt; {message}
          </p>
        )}
      </div>

      {/* Vertical Steps */}
      <div className="relative pl-8 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1px] before:bg-border">
        {stages.map((stage, idx) => {
          const status = getStageStatus(stage.key);
          const numStr = String(idx + 1).padStart(2, '0');

          return (
            <div key={stage.key} className="relative flex gap-4 items-start">
              {/* Timeline Indicator Node */}
              <div className="absolute -left-[29px] top-0 z-10 flex items-center justify-center bg-background rounded-none">
                {status === 'completed' && (
                  <div className="w-[23px] h-[23px] bg-status-passed/10 border border-status-passed flex items-center justify-center text-status-passed text-[10px] font-bold">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                )}
                {status === 'active' && (
                  <div className="w-[23px] h-[23px] bg-ring/10 border border-ring flex items-center justify-center text-ring text-[10px] font-bold font-mono">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </div>
                )}
                {status === 'pending' && (
                  <div className="w-[23px] h-[23px] bg-card border border-border flex items-center justify-center text-muted-foreground text-[10px] font-mono">
                    {numStr}
                  </div>
                )}
                {status === 'failed' && (
                  <div className="w-[23px] h-[23px] bg-status-blocked/10 border border-status-blocked flex items-center justify-center text-status-blocked text-[10px] font-bold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>

              {/* Text Context */}
              <div className={`flex-1 transition-all duration-300 ${status === 'active' ? 'opacity-100 translate-x-1' : status === 'pending' ? 'opacity-35' : 'opacity-85'}`}>
                <h4 className={`text-sm font-semibold ${status === 'active' ? 'text-ring' : status === 'failed' ? 'text-destructive' : 'text-foreground'}`}>
                  {stage.label}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stage.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
