import React from 'react';

interface SeverityBadgeProps {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info' | string;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const sev = severity.toLowerCase();

  const styles: Record<string, string> = {
    critical: 'bg-red-500/10 text-red-500 border border-red-500/20 dark:bg-severity-critical/10 dark:text-severity-critical dark:border-severity-critical/20',
    high: 'bg-orange-500/10 text-orange-500 border border-orange-500/20 dark:bg-severity-high/10 dark:text-severity-high dark:border-severity-high/20',
    medium: 'bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 dark:bg-severity-medium/10 dark:text-severity-medium dark:border-severity-medium/20',
    low: 'bg-blue-500/10 text-blue-500 border border-blue-500/20 dark:bg-severity-low/10 dark:text-severity-low dark:border-severity-low/20',
    info: 'bg-gray-500/10 text-gray-500 border border-gray-500/20 dark:bg-severity-info/10 dark:text-severity-info dark:border-severity-info/20',
  };

  const currentStyle = styles[sev] || styles.info;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${currentStyle}`}>
      {severity}
    </span>
  );
}
