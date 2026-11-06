"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

const TOAST_MS = 6000;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
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
    <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-toast py-1.5 pr-1.5 pl-4 text-toast-fg shadow-ticket motion-safe:animate-[toast-in_220ms_var(--ease-out-expo)]">
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

/** Polite live region: toasts never steal focus. */
export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] z-50 mx-auto flex max-w-md flex-col gap-2 px-4">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
