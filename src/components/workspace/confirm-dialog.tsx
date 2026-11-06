"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  trigger: (open: () => void) => React.ReactNode;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Return an error message to keep the dialog open and show it; null or nothing closes it. */
  onConfirm: () => void | Promise<string | null | void>;
  busyLabel?: string;
}

/** One clear question for actions that cannot be undone (brief 6.8). Native dialog: focus and Escape for free. */
export function ConfirmDialog({ trigger, title, body, confirmLabel, danger, onConfirm, busyLabel = "Working…" }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
  }, [open]);
  return (
    <>
      {trigger(() => setOpen(true))}
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        aria-busy={busy}
        onClose={() => {
          setOpen(false);
          setError("");
        }}
        onCancel={(e) => busy && e.preventDefault()} className="m-auto w-[min(26rem,calc(100vw-2rem))] ticket px-5 text-ink backdrop:bg-ink/55">
        <h2 id={titleId} className="text-xl">
          {title}
        </h2>
        <div className="mt-2 space-y-2 text-ink-soft">{body}</div>
        <p role="alert" className={error ? "mt-3 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad" : "sr-only"}>
          {error}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              // Stays open while the server answers: on patchy data the host sees it working, never a frozen screen.
              const failure = await onConfirm();
              setBusy(false);
              if (failure) setError(failure);
              else ref.current?.close();
            }}
          >
            {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
