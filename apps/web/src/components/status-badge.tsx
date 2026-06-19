import React from "react";

interface StatusBadgeProps {
  status:
    | "passed"
    | "passed with warnings"
    | "needs cleanup"
    | "risky"
    | "blocked"
    | string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const norm = status.toLowerCase();

  const styles: Record<string, string> = {
    passed:
      "bg-green-500/10 text-green-500 border border-green-500/20 dark:bg-status-passed/10 dark:text-status-passed dark:border-status-passed/20",
    "passed with warnings":
      "bg-amber-500/10 text-amber-500 border border-amber-500/20 dark:bg-status-warning/10 dark:text-status-warning dark:border-status-warning/20",
    "needs cleanup":
      "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 dark:bg-status-warning/10 dark:text-status-warning dark:border-status-warning/20",
    risky:
      "bg-orange-500/10 text-orange-500 border border-orange-500/20 dark:bg-status-risky/10 dark:text-status-risky dark:border-status-risky/20",
    blocked:
      "bg-red-500/10 text-red-500 border border-red-500/20 dark:bg-status-blocked/10 dark:text-status-blocked dark:border-status-blocked/20",
  };

  const currentStyle =
    styles[norm] || "bg-gray-500/10 text-gray-500 border border-gray-500/20";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide border ${currentStyle}`}
    >
      {status}
    </span>
  );
}
