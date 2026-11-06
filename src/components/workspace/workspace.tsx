"use client";

import { ReceiptText, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo } from "react";
import { buttonVariants } from "@/components/ui/button";
import { useSession, type AddInput, type OverlayEntry } from "@/hooks/use-session";
import { consolidate } from "@/lib/consolidate";
import type { SessionSnapshot } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { canEditEntry } from "@/lib/permissions";
import { Composer } from "./composer";
import { OrderTicket, type TicketActions } from "./order-ticket";
import { SessionHeader } from "./session-header";
import { Toasts, useToasts } from "./toasts";

const copyFor = (roundNumber: number): 1 | 2 | 3 => (roundNumber >= 3 ? 3 : roundNumber === 2 ? 2 : 1);

export function Workspace({ initial }: { initial: SessionSnapshot }) {
  const { snapshot, entries, pending, sync, mutate, retry, dismiss } = useSession(initial);
  const { toasts, show, dismiss: dismissToast } = useToasts();
  const round = snapshot.rounds.find((r) => r.id === snapshot.activeRoundId) ?? snapshot.rounds[0];
  const roundEntries = useMemo(() => entries.filter((e) => e.roundId === round.id), [entries, round.id]);
  const total = consolidate(roundEntries).totalItems;
  const isHost = snapshot.me.role === "HOST";
  const isOpen = snapshot.session.status === "OPEN" && round.status === "DRAFT";
  const failed = pending.filter((p) => p.status === "failed");

  const knownLabels = useMemo(
    () => [...new Set([...snapshot.participants.map((p) => p.displayName), ...snapshot.entries.map((e) => e.attribution.label).filter((l): l is string => Boolean(l))])],
    [snapshot],
  );

  const add = useCallback(
    async (input: AddInput) => {
      const result = await mutate({ kind: "add", input });
      if (result?.entryId) {
        const entryId = result.entryId;
        show({
          message: `Added ${input.dishName.trim()} ×${input.quantity}. Ayos!`,
          action: { label: "Undo", run: () => void mutate({ kind: "remove", entryId }) },
        });
      }
    },
    [mutate, show],
  );

  const actions: TicketActions = {
    canEdit: (entry) => canEditEntry(snapshot.me, entry),
    setQuantity: (entry: OverlayEntry, quantity) => void mutate({ kind: "update", entryId: entry.id, expectedRevision: entry.revision, quantity }),
    remove: (entry: OverlayEntry) => {
      void mutate({ kind: "remove", entryId: entry.id });
      show({ message: `Removed ${entry.dishName} ×${entry.quantity}.`, action: { label: "Undo", run: () => void mutate({ kind: "restore", entryId: entry.id }) } });
    },
  };

  return (
    <div className="min-h-dvh pb-[calc(env(safe-area-inset-bottom)+11rem)]">
      <SessionHeader
        title={snapshot.session.title}
        roundNumber={round.number}
        roundStatus={round.status}
        sync={sync}
        canRename={isHost && snapshot.session.status === "OPEN"}
        onRename={(title) => void mutate({ kind: "rename", title })}
      />

      <main className="mx-auto max-w-2xl px-3 pt-5">
        {failed.length > 0 ? (
          <div role="alert" className="mb-4 space-y-2 rounded-2xl bg-bad-wash p-3 text-bad">
            {failed.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{item.error}</span>
                {item.error?.includes("changed") ? null : (
                  <button type="button" onClick={() => retry(item.key)} className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full px-3 font-semibold hover:bg-bad/10">
                    <RotateCw className="size-4" aria-hidden /> Retry
                  </button>
                )}
                <button type="button" onClick={() => dismiss(item.key)} aria-label="Discard this change" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-bad/10">
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <OrderTicket entries={roundEntries} people={snapshot.participants} roundNumber={round.number} copy={copyFor(round.number)} actions={actions} readOnly={!isOpen} />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-paper from-70% to-transparent pt-6 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        <div className="mx-auto max-w-2xl space-y-2 px-3">
          {isOpen ? <Composer dishNames={snapshot.dishNames} knownLabels={knownLabels} onAdd={(input) => void add(input)} /> : null}
          <div className="flex items-center justify-between gap-3 px-2">
            <p className="text-ink-soft">
              <span className="tally text-xl text-ink">{total}</span> {total === 1 ? "item" : "items"} this round
            </p>
            <Link
              href={`/s/${snapshot.session.id}/waiter`}
              aria-disabled={total === 0}
              className={cn(buttonVariants({ variant: "outline" }), total === 0 && "pointer-events-none opacity-45")}
            >
              <ReceiptText className="size-5" aria-hidden />
              Show waiter
            </Link>
          </div>
        </div>
      </div>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
