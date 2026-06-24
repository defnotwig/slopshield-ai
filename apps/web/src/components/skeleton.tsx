import React from "react";
import { cn } from "@/lib/utils";

/**
 * Skeleton placeholder for loading states.
 * Uses design tokens + a subtle pulse so it reads well in both light and dark.
 */
export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-sm bg-muted", className)}
    />
  );
}
