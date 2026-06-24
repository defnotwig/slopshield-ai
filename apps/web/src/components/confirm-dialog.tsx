"use client";

import React, { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly loading?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Accessible, theme-aware confirmation modal.
 * Replaces native window.confirm() with a branded dialog:
 * role="dialog" + aria-modal, Escape-to-close, backdrop dismiss, focus-visible.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={onCancel}
        className="absolute inset-0 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-md bg-card border border-border rounded-sm shadow-2xl p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <span className="p-2 rounded-sm bg-destructive/10 text-destructive shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </span>
          )}
          <div className="space-y-1">
            <h3 id="confirm-dialog-title" className="text-sm font-bold text-foreground">
              {title}
            </h3>
            {description && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold rounded-sm border border-border bg-transparent text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-xs font-bold rounded-sm disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-foreground text-background hover:bg-foreground/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
