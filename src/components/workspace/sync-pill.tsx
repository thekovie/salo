import { Check, CloudOff, LoaderCircle, TriangleAlert, GitCompareArrows } from "lucide-react";
import type { SyncState } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

const STATES: Record<SyncState, { label: string; Icon: typeof Check; spin?: boolean }> = {
  saving: { label: "Saving…", Icon: LoaderCircle, spin: true },
  saved: { label: "Saved", Icon: Check },
  unsynced: { label: "Offline · not saved yet", Icon: CloudOff },
  conflict: { label: "Changed elsewhere", Icon: GitCompareArrows },
  failed: { label: "Not saved", Icon: TriangleAlert },
};

/** Sync status in words and an icon, never colour alone; announced politely to screen readers (brief 6.6). */
export function SyncPill({ state, className }: { state: SyncState; className?: string }) {
  const { label, Icon, spin } = STATES[state];
  const alarming = state === "failed" || state === "conflict" || state === "unsynced";
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        alarming ? "bg-saffron text-ink" : "bg-ink/20 text-on-tomato",
        className,
      )}
    >
      <Icon className={cn("size-3.5", spin && "animate-spin")} aria-hidden />
      {label}
    </span>
  );
}
