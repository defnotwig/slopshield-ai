import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx + tailwind-merge.
 * Prevents class conflicts (e.g. `p-2 p-4` → `p-4`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Return a colour class string for a numeric quality score (0-100).
 */
export function formatScore(score: number): {
  label: string;
  colorClass: string;
} {
  if (score >= 80)
    return { label: "Excellent", colorClass: "text-status-passed" };
  if (score >= 60) return { label: "Fair", colorClass: "text-status-warning" };
  if (score >= 40)
    return { label: "Needs Cleanup", colorClass: "text-status-risky" };
  return { label: "Poor", colorClass: "text-status-blocked" };
}

/**
 * Relative-time formatter ("2 hours ago", "just now", etc.)
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Tailwind colour class for a finding severity string.
 */
export function getSeverityColor(severity: string): {
  bg: string;
  text: string;
  border: string;
} {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    critical: {
      bg: "bg-severity-critical/15",
      text: "text-severity-critical",
      border: "border-severity-critical/40",
    },
    high: {
      bg: "bg-severity-high/15",
      text: "text-severity-high",
      border: "border-severity-high/40",
    },
    medium: {
      bg: "bg-severity-medium/15",
      text: "text-severity-medium",
      border: "border-severity-medium/40",
    },
    low: {
      bg: "bg-severity-low/15",
      text: "text-severity-low",
      border: "border-severity-low/40",
    },
    info: {
      bg: "bg-severity-info/15",
      text: "text-severity-info",
      border: "border-severity-info/40",
    },
  };
  return (
    map[severity.toLowerCase()] ?? {
      bg: "bg-muted",
      text: "text-muted-foreground",
      border: "border-border",
    }
  );
}

/**
 * Tailwind colour class for a scan-result status.
 */
export function getStatusColor(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    passed: { bg: "bg-status-passed/15", text: "text-status-passed" },
    "passed-with-warnings": {
      bg: "bg-status-passed/10",
      text: "text-status-passed",
    },
    "needs-cleanup": {
      bg: "bg-status-warning/15",
      text: "text-status-warning",
    },
    risky: { bg: "bg-status-risky/15", text: "text-status-risky" },
    blocked: { bg: "bg-status-blocked/15", text: "text-status-blocked" },
  };
  return (
    map[status.toLowerCase()] ?? {
      bg: "bg-muted",
      text: "text-muted-foreground",
    }
  );
}

/**
 * Truncate a string and append an ellipsis if it exceeds maxLen.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}
