"use client";

import React, { useState, useEffect } from "react";
import {
  useNotificationSettings,
  useUpdateNotificationSettings,
} from "@/hooks/use-notifications";
import {
  Loader2,
  Save,
  Check,
  AlertCircle,
  Bell,
  Mail,
  MessageSquare,
  Zap,
} from "lucide-react";

export default function SettingsPage() {
  const {
    data: settings,
    isLoading,
    isError,
    refetch,
  } = useNotificationSettings();
  const updateMutation = useUpdateNotificationSettings();

  const [emailAlerts, setEmailAlerts] = useState(true);
  const [larkAlerts, setLarkAlerts] = useState(true);
  const [slackAlerts, setSlackAlerts] = useState(false);
  const [minSeverity, setMinSeverity] = useState("high");
  const [msg, setMsg] = useState({ text: "", type: "" });

  useEffect(() => {
    if (settings) {
      setEmailAlerts(settings.emailAlerts);
      setLarkAlerts(settings.larkAlerts);
      setSlackAlerts(settings.slackAlerts);
      setMinSeverity(settings.minSeverity || "high");
    }
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ text: "", type: "" });
    try {
      await updateMutation.mutateAsync({
        emailAlerts,
        larkAlerts,
        slackAlerts,
        minSeverity,
      });
      setMsg({
        text: "Notification settings updated successfully.",
        type: "success",
      });
      refetch();
    } catch (err: any) {
      setMsg({
        text: err.message || "Failed to update settings.",
        type: "error",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
        <p className="text-sm font-mono text-gray-500">
          Loading alert settings...
        </p>
      </div>
    );
  }

  if (isError || !settings) {
    return (
      <div className="max-w-md mx-auto py-24 text-center space-y-4">
        <div className="p-4 bg-red-500/10 text-red-500 rounded-full w-fit mx-auto border border-red-500/20">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold">Failed to load settings</h3>
        <p className="text-xs text-gray-500">
          Please check your API server connection.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          Account Settings
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Manage your personal notification channels and alert filters for
          SlopShield scans.
        </p>
      </div>

      {msg.text && (
        <div
          className={`p-4 rounded-lg text-xs font-bold flex gap-2 items-center ${
            msg.type === "success"
              ? "bg-green-500/10 border border-green-500/20 text-green-500"
              : "bg-red-500/10 border border-red-500/20 text-red-500"
          }`}
        >
          {msg.type === "success" ? (
            <Check className="w-4.5 h-4.5" />
          ) : (
            <AlertCircle className="w-4.5 h-4.5" />
          )}
          {msg.text}
        </div>
      )}

      <div className="glass-card bg-white dark:bg-gray-900/35 border border-gray-200 dark:border-gray-800 p-8 rounded-lg">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 border-b border-gray-150 dark:border-gray-800 pb-2.5 flex items-center gap-2">
              <Bell className="w-4 h-4 text-cyan-500" />
              Alert Notification Channels
            </h3>

            {/* Email Alerts Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-950/40 border border-gray-100 dark:border-gray-900 rounded-lg">
              <div className="flex gap-3 items-center">
                <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                    Email Reports
                  </h4>
                  <p className="text-xs text-gray-500">
                    Receive summaries of scan completions in your inbox
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={emailAlerts}
                onChange={(e) => setEmailAlerts(e.target.checked)}
                className="w-4.5 h-4.5 accent-cyan-500 cursor-pointer rounded"
              />
            </div>

            {/* Lark Alerts Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-950/40 border border-gray-100 dark:border-gray-900 rounded-lg">
              <div className="flex gap-3 items-center">
                <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                    Lark / Feishu Cards
                  </h4>
                  <p className="text-xs text-gray-500">
                    Receive scan card updates in configured channels
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={larkAlerts}
                onChange={(e) => setLarkAlerts(e.target.checked)}
                className="w-4.5 h-4.5 accent-cyan-500 cursor-pointer rounded"
              />
            </div>

            {/* Slack Alerts Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-950/40 border border-gray-100 dark:border-gray-900 rounded-lg">
              <div className="flex gap-3 items-center">
                <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                    Slack Webhooks
                  </h4>
                  <p className="text-xs text-gray-500">
                    Trigger custom webhook alerts on Slack channels (V2)
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={slackAlerts}
                onChange={(e) => setSlackAlerts(e.target.checked)}
                className="w-4.5 h-4.5 accent-cyan-500 cursor-pointer rounded"
              />
            </div>
          </div>

          <div className="space-y-4 pt-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 border-b border-gray-150 dark:border-gray-800 pb-2.5 flex items-center gap-2">
              Alert Filters
            </h3>

            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
                Minimum Alert Severity
              </label>
              <div className="flex items-center gap-4">
                <select
                  value={minSeverity}
                  onChange={(e) => setMinSeverity(e.target.value)}
                  className="w-48 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-55 dark:bg-gray-950 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="low">Low Severity</option>
                  <option value="medium">Medium Severity</option>
                  <option value="high">High Severity</option>
                  <option value="critical">Critical Severity Only</option>
                </select>
                <span className="text-xs text-gray-500">
                  You will only be alerted for scan findings that match or
                  exceed this severity level.
                </span>
              </div>
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
              Save Preferences
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
