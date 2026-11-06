"use client";

import { Check, CloudOff, GitCompareArrows, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { SyncState } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

const STATES: Record<SyncState, { label: string; Icon: typeof Check; spin?: boolean }> = {
  saving: { label: "Saving…", Icon: LoaderCircle, spin: true },
  saved: { label: "Saved", Icon: Check },
  reconnecting: { label: "Reconnecting…", Icon: RefreshCw, spin: true },
  unsynced: { label: "Offline · not saved yet", Icon: CloudOff },
  conflict: { label: "Changed elsewhere", Icon: GitCompareArrows },
  failed: { label: "Not saved", Icon: TriangleAlert },
};

/** Sync status in words and an icon, never colour alone; announced politely to screen readers (brief 6.6). */
/** Saves usually finish in well under half a second: only say "Saving…" if it takes longer, so the pill does not flicker. */
const SAVING_DELAY_MS = 400;

export function SyncPill({ state, className }: { state: SyncState; className?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state !== "saving") return;
    const timer = setTimeout(() => setSlow(true), SAVING_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [state]);
  const shown: SyncState = state === "saving" && !slow ? "saved" : state;
  const { label, Icon, spin } = STATES[shown];
  const alarming = shown === "failed" || shown === "conflict" || shown === "unsynced";
  return (
    <span
      role="status"
      aria-live="polite"
      data-sync={state}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-200",
        alarming ? "bg-saffron text-ink" : "bg-black/25 text-on-band",
        className,
      )}
    >
      <Icon className={cn("size-3.5", spin && "animate-spin")} aria-hidden />
      <span key={shown} className="fade-in">
        {label}
      </span>
    </span>
  );
}
