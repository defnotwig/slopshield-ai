import React from "react";
import { config } from "@/lib/config";

/**
 * Honest labeling for the demo deploy. Renders a visible banner whenever the
 * app is running on mock data (no backend configured). Renders nothing in live
 * mode so it disappears automatically once a real backend is wired up.
 */
export function MockModeBanner() {
  if (!config.isMock) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-amber-500/10 text-amber-600 border-b border-amber-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide dark:bg-status-warning/10 dark:text-status-warning dark:border-status-warning/20"
    >
      <span aria-hidden="true">⚠</span>
      <span>Demo data — backend not connected</span>
    </div>
  );
}
