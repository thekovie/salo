"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  trigger: (open: () => void) => React.ReactNode;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** One clear question for actions that cannot be undone (brief 6.8). Native dialog: focus and Escape for free. */
export function ConfirmDialog({ trigger, title, body, confirmLabel, danger, onConfirm }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
  }, [open]);
  return (
    <>
      {trigger(() => setOpen(true))}
      <dialog ref={ref} aria-labelledby={titleId} onClose={() => setOpen(false)} className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-[1.4rem] bg-ticket p-5 text-ink shadow-ticket backdrop:bg-ink/55">
        <h2 id={titleId} className="text-xl">
          {title}
        </h2>
        <div className="mt-2 space-y-2 text-ink-soft">{body}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              ref.current?.close();
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
