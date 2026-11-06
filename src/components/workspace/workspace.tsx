"use client";

import { CircleCheck, Hand, ReceiptText, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { describeOp, useSession, type AddInput, type OverlayEntry } from "@/hooks/use-session";
import { consolidate } from "@/lib/consolidate";
import type { SessionSnapshot } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { canEditEntry } from "@/lib/permissions";
import { readinessSummary } from "@/lib/views";
import { Composer } from "./composer";
import { GroupsView } from "./groups-view";
import { PeopleView } from "./people-view";
import { ViewTabs, type View } from "./view-tabs";
import { InviteSheet } from "./invite-sheet";
import { OrderTicket, type TicketActions } from "./order-ticket";
import { SessionHeader } from "./session-header";
import { Toasts, useToasts } from "./toasts";

const copyFor = (roundNumber: number): 1 | 2 | 3 => (roundNumber >= 3 ? 3 : roundNumber === 2 ? 2 : 1);

export function Workspace({ initial, appUrl }: { initial: SessionSnapshot; appUrl: string }) {
  const { snapshot, entries, failed, sync, mutate, dismiss, entryById } = useSession(initial);
  const { toasts, show, dismiss: dismissToast } = useToasts();
  const round = snapshot.rounds.find((r) => r.id === snapshot.activeRoundId) ?? snapshot.rounds[0];
  const roundEntries = useMemo(() => entries.filter((e) => e.roundId === round.id), [entries, round.id]);
  const total = consolidate(roundEntries).totalItems;
  const isHost = snapshot.me.role === "HOST";
  const isOpen = snapshot.session.status === "OPEN" && round.status === "DRAFT";

  const [view, setView] = useState<View>("order");
  const ready = readinessSummary(snapshot);
  const iAmReady = ready.readyIds.has(snapshot.me.participantId);
  const groupCount = new Set(roundEntries.filter((e) => e.attribution.type === "GROUP").map((e) => e.attribution.label?.toLowerCase())).size;
  const claimsForHost = isHost
    ? snapshot.claims.flatMap((claim) => {
        const entry = snapshot.entries.find((e) => e.batchId === claim.batchId);
        const who = snapshot.participants.find((p) => p.id === claim.requestedBy)?.displayName ?? "A guest";
        return entry ? [{ claim, entry, who }] : [];
      })
    : [];

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
          action: {
            label: "Undo",
            run: () => {
              const entry = entryById(entryId);
              if (entry) void mutate({ kind: "remove", entry });
            },
          },
        });
      }
    },
    [mutate, show, entryById],
  );

  const actions: TicketActions = {
    canEdit: (entry) => canEditEntry(snapshot.me, entry),
    setQuantity: (entry: OverlayEntry, quantity) => void mutate({ kind: "update", entry, quantity }),
    remove: (entry: OverlayEntry) => {
      void mutate({ kind: "remove", entry });
      // Queued behind the removal, so Undo can never reach the server before it.
      show({ message: `Removed ${entry.dishName} ×${entry.quantity}.`, action: { label: "Undo", run: () => void mutate({ kind: "restore", entry }) } });
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
        actions={
          snapshot.session.status === "OPEN" ? (
            <InviteSheet appUrl={appUrl} joinCode={snapshot.session.joinCode} title={snapshot.session.title} peopleCount={snapshot.participants.length} />
          ) : null
        }
      />

      <main className="mx-auto max-w-2xl px-3 pt-5">
        {failed.length > 0 ? (
          <div role="alert" className="mb-4 space-y-2 rounded-2xl bg-bad-wash p-3 text-bad">
            <p className="text-sm font-semibold">Not saved. The ticket shows what the order really has now.</p>
            {failed.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  <span className="font-semibold">{describeOp(item.op)}:</span> {item.error}
                </span>
                <button type="button" onClick={() => dismiss(item.key)} aria-label={`Dismiss: ${describeOp(item.op)}`} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-bad/10">
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {claimsForHost.length > 0 ? (
          <section aria-label="Requests from guests" className="mb-4 space-y-2 rounded-2xl bg-saffron-wash p-3">
            {claimsForHost.map(({ claim, entry, who }) => (
              <div key={claim.id} className="flex flex-wrap items-center gap-2">
                <Hand className="size-4 shrink-0 text-saffron-ink" aria-hidden />
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold">{who}</span> says {entry.dishName} ×{entry.quantity} is theirs.
                </p>
                <div className="flex gap-1">
                  <button type="button" onClick={() => void mutate({ kind: "resolveClaim", claimId: claim.id, approve: false, dishName: entry.dishName })} className="min-h-11 cursor-pointer rounded-full px-3 text-sm font-semibold hover:bg-ink/6">
                    Decline
                  </button>
                  <button type="button" onClick={() => void mutate({ kind: "resolveClaim", claimId: claim.id, approve: true, dishName: entry.dishName })} className="min-h-11 cursor-pointer rounded-full bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink/90">
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </section>
        ) : null}
        <ViewTabs view={view} onChange={setView} counts={{ people: snapshot.participants.length, groups: groupCount }} />
        <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
          {view === "order" ? (
            <OrderTicket entries={roundEntries} people={snapshot.participants} roundNumber={round.number} copy={copyFor(round.number)} actions={actions} readOnly={!isOpen} />
          ) : view === "people" ? (
            <PeopleView
              snapshot={snapshot}
              entries={roundEntries.filter((e) => !e.pending)}
              canClaim={!isHost && isOpen}
              onClaim={(entry) => void mutate({ kind: "claim", batchId: entry.batchId, dishName: entry.dishName })}
              onRemoveDuplicate={(entry) => actions.remove(entry)}
            />
          ) : (
            <GroupsView snapshot={snapshot} entries={roundEntries.filter((e) => !e.pending)} onSetMembers={(label, memberIds) => void mutate({ kind: "groupMembers", label, memberIds })} />
          )}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-paper from-70% to-transparent pt-6 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        <div className="mx-auto max-w-2xl space-y-2 px-3">
          {isOpen ? <Composer dishNames={snapshot.dishNames} knownLabels={knownLabels} defaultFor={isHost ? "UNASSIGNED" : "ME"} onAdd={(input) => void add(input)} /> : null}
          <div className="flex items-center justify-between gap-3 px-2">
            <div className="min-w-0">
              <p className="whitespace-nowrap text-ink-soft" data-testid="round-total">
                <span className="tally text-xl text-ink">{total}</span> {total === 1 ? "item" : "items"}
                <span className="hidden sm:inline"> this round</span>
              </p>
              {isHost && ready.total > 0 ? (
                <p className="text-sm text-ink-soft">
                  {ready.ready} of {ready.total} {ready.total === 1 ? "guest" : "guests"} ready
                </p>
              ) : null}
            </div>
            {!isHost && isOpen ? (
              <button
                type="button"
                aria-pressed={iAmReady}
                onClick={() => void mutate({ kind: "ready", ready: !iAmReady })}
                className={cn(
                  "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 font-semibold transition-colors",
                  iAmReady ? "bg-ok-wash text-ok" : "border-[1.5px] border-input bg-ticket text-ink hover:bg-paper",
                )}
              >
                <CircleCheck className="size-5" aria-hidden />
                {iAmReady ? "Ready" : "I’m ready"}
              </button>
            ) : null}
            <Link
              href={`/s/${snapshot.session.id}/waiter`}
              aria-disabled={total === 0}
              tabIndex={total === 0 ? -1 : undefined}
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
