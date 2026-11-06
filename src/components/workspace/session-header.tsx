"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import type { SyncState } from "@/hooks/use-session";
import { SyncPill } from "./sync-pill";

interface SessionHeaderProps {
  title: string | null;
  roundNumber: number;
  roundStatus: "DRAFT" | "CONFIRMED";
  /** null while the order is open. */
  ended?: "ended" | "cancelled" | null;
  sync: SyncState;
  /** Host only: opens the order options (name, cancel or end). */
  onOptions?: () => void;
  actions?: React.ReactNode;
}

/**
 * The tomato band: which table, which round, whether everything is saved. One row on a phone: the name gets the
 * width, sync status sits on the line under it, and settings live behind one button instead of an inline field.
 */
export function SessionHeader({ title, roundNumber, roundStatus, ended = null, sync, onOptions, actions }: SessionHeaderProps) {
  const status = ended === "cancelled" ? "Cancelled" : ended ? "Order ended" : `Round ${roundNumber} · ${roundStatus === "DRAFT" ? "Open" : "Confirmed"}`;
  return (
    <header className="sticky top-0 z-30 bg-band text-on-band pt-[env(safe-area-inset-top)] shadow-[0_6px_16px_-10px_oklch(0.3_0.1_30/0.6)]">
      <div className="mx-auto flex max-w-2xl items-center gap-1.5 px-2 py-2">
        <Link href="/" aria-label="Salo home" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-on-band/10">
          <LogoMark inverse className="size-8" />
        </Link>
        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate font-display text-lg leading-tight">
            {onOptions ? (
              // A bigger tap target for the same options; keyboard and screen-reader users get the labelled button.
              <button type="button" tabIndex={-1} onClick={onOptions} className="block max-w-full cursor-pointer truncate text-left">
                {title ?? <span className="opacity-80">Name this order</span>}
              </button>
            ) : (
              (title ?? "Table order")
            )}
          </h1>
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-xs tracking-[0.12em] uppercase opacity-90">{status}</span>
            {ended ? null : <SyncPill state={sync} compact className="shrink-0 px-1.5 py-0.5" />}
          </div>
        </div>
        {actions}
        {onOptions ? (
          <button type="button" onClick={onOptions} aria-label="Order options" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-on-band/10">
            <Ellipsis className="size-6" aria-hidden />
          </button>
        ) : null}
      </div>
    </header>
  );
}
