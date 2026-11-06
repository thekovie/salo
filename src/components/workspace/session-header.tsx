"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import type { SyncState } from "@/hooks/use-session";
import { SyncPill } from "./sync-pill";

interface SessionHeaderProps {
  title: string | null;
  roundNumber: number;
  roundStatus: "DRAFT" | "CONFIRMED";
  sync: SyncState;
  canRename: boolean;
  onRename: (title: string | null) => void;
  actions?: React.ReactNode;
}

/** The tomato band: what table this is, which round, and whether everything is saved. */
export function SessionHeader({ title, roundNumber, roundStatus, sync, canRename, onRename, actions }: SessionHeaderProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title ?? "");

  function save() {
    setEditing(false);
    const next = draft.trim() || null;
    if (next !== title) onRename(next);
  }

  return (
    <header className="sticky top-0 z-30 bg-tomato text-on-tomato pt-[env(safe-area-inset-top)] shadow-[0_6px_16px_-10px_oklch(0.3_0.1_30/0.6)]">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2">
        <Link href="/" aria-label="Salo home" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-on-tomato/10">
          <LogoMark inverse className="size-8" />
        </Link>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <label htmlFor={id} className="sr-only">
                Order name
              </label>
              <input
                id={id}
                autoFocus
                value={draft}
                maxLength={60}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => e.key === "Escape" && (setDraft(title ?? ""), setEditing(false))}
                placeholder="Restaurant or occasion"
                className="w-full rounded-lg bg-on-tomato/15 px-2 py-1 font-display text-lg text-on-tomato placeholder:text-on-tomato/70 focus-visible:outline-on-tomato"
              />
            </form>
          ) : canRename ? (
            <button type="button" onClick={() => (setDraft(title ?? ""), setEditing(true))} className="group flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg px-1 text-left">
              <span className="truncate font-display text-lg leading-tight">{title ?? "Name this order"}</span>
              <Pencil className="size-3.5 shrink-0 opacity-70 group-hover:opacity-100" aria-hidden />
              <span className="sr-only">(rename)</span>
            </button>
          ) : (
            <h1 className="truncate px-1 font-display text-lg leading-tight">{title ?? "Table order"}</h1>
          )}
          <div className="mt-0.5 flex items-center gap-2 px-1">
            <span className="font-mono text-xs tracking-[0.12em] uppercase opacity-90">
              Round {roundNumber} · {roundStatus === "DRAFT" ? "Taking orders" : "Confirmed"}
            </span>
          </div>
        </div>
        <SyncPill state={sync} />
        {actions}
      </div>
    </header>
  );
}
