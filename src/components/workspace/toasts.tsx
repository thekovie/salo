"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface Toast {
  id: number;
  leaving?: boolean;
  message: string;
  action?: { label: string; run: () => void };
}

const TOAST_MS = 6000;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const LEAVE_MS = 160;
  // Fade out, then remove (reduced motion collapses the fade but keeps the order of events).
  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), LEAVE_MS);
  }, []);
  const show = useCallback((toast: Omit<Toast, "id">) => {
    const id = nextId.current++;
    // One at a time: the newest message replaces the last, so Undo always refers to what just happened.
    setToasts([{ ...toast, id }]);
    return id;
  }, []);
  return { toasts, show, dismiss };
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);
  return (
    <div className={cn("pointer-events-auto flex items-center gap-2 rounded-2xl bg-toast py-1.5 pr-1.5 pl-4 text-toast-fg shadow-ticket motion-safe:animate-[toast-in_220ms_var(--ease-out-expo)]", toast.leaving && "toast-leaving")}>
      <span className="flex-1 text-sm">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="min-h-11 cursor-pointer rounded-full px-3 text-sm font-semibold text-toast-action hover:bg-toast-fg/10"
          onClick={() => {
            toast.action?.run();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button type="button" aria-label="Dismiss" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-toast-fg/10" onClick={() => onDismiss(toast.id)}>
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The one floating stack, sitting just above the dock at its measured height (`--dock-h`, set by the workspace), so
 * nothing covers the composer or the content's top. `notices` (connection, who added what) stack above the toasts.
 * Polite live region: toasts never steal focus.
 */
export function Toasts({ toasts, onDismiss, notices }: { toasts: Toast[]; onDismiss: (id: number) => void; notices?: React.ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--dock-h,9.5rem)+0.5rem)] z-50 mx-auto flex max-w-md flex-col gap-2 px-4">
      {notices}
      <div aria-live="polite" className="flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}
