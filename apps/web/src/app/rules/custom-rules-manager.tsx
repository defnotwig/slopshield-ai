"use client";

import React, { useEffect, useState } from "react";
import {
  useProjects,
  useCustomRules,
  useSaveCustomRules,
} from "@/hooks/use-custom-rules";
import { CustomRule } from "@slopshield/shared";
import { Plus, Trash2, Save, FlaskConical, Loader2 } from "lucide-react";

const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const CATEGORIES = [
  "backend-security",
  "frontend-security",
  "backend-architecture",
  "frontend-architecture",
  "maintainability",
  "testability",
  "accessibility",
  "reliability",
  "documentation",
  "general",
];

function blankRule(): CustomRule {
  return {
    id: `rule_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    name: "New custom rule",
    pattern: "",
    severity: "medium" as CustomRule["severity"],
    category: "maintainability" as CustomRule["category"],
    message: "",
    enabled: true,
  };
}

/**
 * Per-project custom rule editor: pick a project, add/edit/remove regex rules,
 * and persist the full set. Mirrors the CustomRuleAnalyzer's rule shape.
 */
export function CustomRulesManager() {
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const { data: serverRules, isLoading } = useCustomRules(projectId);
  const saveMutation = useSaveCustomRules();

  const [rules, setRules] = useState<CustomRule[]>([]);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    if (projects && projects.length > 0 && !projectId) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  useEffect(() => {
    setRules(serverRules ?? []);
  }, [serverRules]);

  const updateRule = (idx: number, patch: Partial<CustomRule>) => {
    setRules((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };

  const handleSave = async () => {
    if (!projectId) return;
    setSaveMsg("");
    try {
      await saveMutation.mutateAsync({ projectId, rules });
      setSaveMsg("Custom rules saved.");
    } catch (err: any) {
      setSaveMsg(err?.message || "Save failed — check rule patterns.");
    }
  };

  return (
    <div className="space-y-4 border border-border bg-card p-5 rounded-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-ring" />
            Per-Project Custom Rules
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Regex rules applied as an extra analyzer pass for the selected
            project.
          </p>
        </div>
        <select
          value={projectId ?? ""}
          onChange={(e) => setProjectId(e.target.value || null)}
          aria-label="Select project for custom rules"
          className="px-3 py-1.5 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {(projects ?? []).length === 0 && <option value="">No projects</option>}
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-xs font-mono text-muted-foreground py-6 text-center">
          Loading custom rules...
        </p>
      ) : (
        <div className="space-y-3">
          {rules.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No custom rules yet. Add one below.
            </p>
          )}
          {rules.map((rule, idx) => (
            <div
              key={rule.id}
              className="border border-border rounded-sm p-3 space-y-2 bg-muted/10"
            >
              <div className="flex items-center gap-2">
                <input
                  value={rule.name}
                  onChange={(e) => updateRule(idx, { name: e.target.value })}
                  placeholder="Rule name"
                  className="flex-1 px-2 py-1 text-xs rounded-sm border border-border bg-background text-foreground"
                />
                <label className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground uppercase">
                  <input
                    type="checkbox"
                    checked={rule.enabled !== false}
                    onChange={(e) =>
                      updateRule(idx, { enabled: e.target.checked })
                    }
                  />
                  Enabled
                </label>
                <button
                  onClick={() =>
                    setRules((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Delete rule"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <input
                value={rule.pattern}
                onChange={(e) => updateRule(idx, { pattern: e.target.value })}
                placeholder="Regex pattern (e.g. console\\.log)"
                className="w-full px-2 py-1 text-xs font-mono rounded-sm border border-border bg-background text-foreground"
              />
              <input
                value={rule.message}
                onChange={(e) => updateRule(idx, { message: e.target.value })}
                placeholder="Why it matters (shown on the finding)"
                className="w-full px-2 py-1 text-xs rounded-sm border border-border bg-background text-foreground"
              />
              <div className="flex flex-wrap gap-2">
                <select
                  value={rule.severity}
                  onChange={(e) =>
                    updateRule(idx, {
                      severity: e.target.value as CustomRule["severity"],
                    })
                  }
                  className="px-2 py-1 text-xs rounded-sm border border-border bg-background text-foreground capitalize"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={rule.category}
                  onChange={(e) =>
                    updateRule(idx, {
                      category: e.target.value as CustomRule["category"],
                    })
                  }
                  className="px-2 py-1 text-xs rounded-sm border border-border bg-background text-foreground"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground uppercase">
                  <input
                    type="checkbox"
                    checked={rule.blocking ?? false}
                    onChange={(e) =>
                      updateRule(idx, { blocking: e.target.checked })
                    }
                  />
                  Blocking
                </label>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              onClick={() => setRules((prev) => [...prev, blankRule()])}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-sm border border-border bg-muted/20 text-foreground hover:bg-foreground hover:text-background transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Rule
            </button>
            <div className="flex items-center gap-3">
              {saveMsg && (
                <span className="text-[11px] font-mono text-muted-foreground">
                  {saveMsg}
                </span>
              )}
              <button
                onClick={handleSave}
                disabled={!projectId || saveMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-all"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save Rules
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
