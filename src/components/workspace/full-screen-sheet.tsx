"use client";

import { useEffect, useRef } from "react";

interface FullScreenSheetProps {
  label: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}

/**
 * A full-screen layer as a native modal dialog: focus moves in, the page behind is inert, Escape (or Android back
 * swipe in supporting browsers) closes it, and focus returns to what opened it.
 */
export function FullScreenSheet({ label, onClose, className, children }: FullScreenSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-paper p-0 text-ink backdrop:bg-paper ${className ?? ""}`}
    >
      {children}
    </dialog>
  );
}
