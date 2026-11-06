"use client";

import { CircleCheck, Hand, Lock, Plus, ReceiptText, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";
import { Button } from "@/components/ui/button";
import { describeOp, useSession, type AddInput, type OverlayEntry } from "@/hooks/use-session";
import { consolidate } from "@/lib/consolidate";
import type { SessionSnapshot } from "@/lib/snapshot";
import { liveTicket } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import { canEditEntry } from "@/lib/permissions";
import { byGroup, readinessSummary } from "@/lib/views";
import { Composer } from "./composer";
import { GroupsView } from "./groups-view";
import { PeopleView } from "./people-view";
import { ReviewPanel } from "./review-panel";
import { RoundsView, type CorrectionRequest } from "./rounds-view";
import { WaiterPanel } from "./waiter-panel";
import { ViewTabs, type View } from "./view-tabs";
import { InviteSheet } from "./invite-sheet";
import { OrderTicket, type TicketActions } from "./order-ticket";
import { SessionHeader } from "./session-header";
import { Toasts, useToasts } from "./toasts";

const copyFor = (roundNumber: number): 1 | 2 | 3 => (roundNumber >= 3 ? 3 : roundNumber === 2 ? 2 : 1);

export function Workspace({ initial, appUrl }: { initial: SessionSnapshot; appUrl: string }) {
  const { snapshot, entries, pending, failed, sync, mutate, dismiss, entryById } = useSession(initial);
  const { toasts, show, dismiss: dismissToast } = useToasts();
  const round = snapshot.rounds.find((r) => r.id === snapshot.activeRoundId) ?? snapshot.rounds[0];
  const roundEntries = useMemo(() => entries.filter((e) => e.roundId === round.id), [entries, round.id]);
  const total = consolidate(roundEntries).totalItems;
  const isHost = snapshot.me.role === "HOST";
  const sessionOpen = snapshot.session.status === "OPEN";
  const isOpen = sessionOpen && round.status === "DRAFT";
  const unsaved = pending.filter((p) => p.status !== "failed").length;

  const [view, setView] = useState<View>(sessionOpen ? "order" : "rounds");
  const [justConfirmed, setJustConfirmed] = useState<string | null>(null);
  // A panel belongs to the round it was opened for: if the round changes underneath (confirmed or started on another
  // device), it closes instead of silently showing something else. The host's own confirmation keeps the stamped ticket.
  const roundKey = `${round.id}:${round.status}`;
  const [modeState, setModeState] = useState<{ mode: "edit" | "review" | "waiter"; key: string }>({ mode: "edit", key: roundKey });
  const mode = modeState.key === roundKey || justConfirmed === round.id ? modeState.mode : "edit";
  const setMode = (next: "edit" | "review" | "waiter") => setModeState({ mode: next, key: roundKey });
  useEffect(() => {
    if (!justConfirmed) return;
    const timer = setTimeout(() => setJustConfirmed(null), 1500); // the stamp plays once
    return () => clearTimeout(timer);
  }, [justConfirmed]);
  const ticket = liveTicket({ roundNumber: round.number, title: snapshot.session.title, ticket: consolidate(roundEntries), corrections: snapshot.corrections, roundId: round.id });
  const confirmedTicket = round.status === "CONFIRMED" ? snapshot.tickets[round.id] : undefined;
  const correctionsThisRound = ticket.corrections.length;
  const ready = readinessSummary(snapshot);
  const iAmReady = ready.readyIds.has(snapshot.me.participantId);
  const groupCount = byGroup(roundEntries, snapshot.groups).length;
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

  async function confirmRound() {
    let failure = "";
    const result = await mutate(
      { kind: "confirm", roundId: round.id, roundNumber: round.number, expectedRevision: snapshot.session.revision },
      { onError: (message) => (failure = message) },
    );
    if (result) {
      setJustConfirmed(round.id);
      setModeState({ mode: "waiter", key: `${round.id}:CONFIRMED` });
      show({ message: `Round ${round.number} confirmed. Kain na!` });
    } else {
      setMode("review");
      show({ message: `Not confirmed. ${failure || "Try again."}` });
    }
  }

  async function openRound() {
    const next = round.number + 1;
    if (await mutate({ kind: "openRound", roundNumber: next })) {
      setView("order");
      show({ message: `Round ${next} started. Add-ons go here.` });
    }
  }

  const correct = (request: CorrectionRequest) => void mutate({ kind: "correction", ...request });

  async function closeOrder() {
    if (await mutate({ kind: "close" })) setView("rounds");
  }

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
        {!sessionOpen ? (
          <div role="status" className="mb-4 flex items-start gap-2.5 rounded-2xl bg-ink/6 p-4">
            <Lock className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p>
              This order has ended. Nothing can be changed. Everything is deleted on{" "}
              {new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric" }).format(new Date(snapshot.session.expiresAt))}.
            </p>
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
        <ViewTabs view={view} onChange={setView} counts={{ people: snapshot.participants.length, groups: groupCount, rounds: snapshot.rounds.length > 1 ? snapshot.rounds.length : 0 }} />
        <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
          {view === "order" && confirmedTicket ? (
            <div className="space-y-4">
              <WaiterTicket ticket={confirmedTicket} size="compact" confirmed justConfirmed={justConfirmed === round.id} />
              {sessionOpen ? (
                isHost ? (
                  <Button size="lg" className="w-full" onClick={() => void openRound()}>
                    <Plus className="size-5" aria-hidden /> Start round {round.number + 1}
                  </Button>
                ) : (
                  <p className="text-center text-ink-soft">The host confirmed round {round.number} with the waiter. Want more? The host can start a new round.</p>
                )
              ) : null}
            </div>
          ) : view === "order" ? (
            <OrderTicket entries={roundEntries} people={snapshot.participants} roundNumber={round.number} copy={copyFor(round.number)} actions={actions} readOnly={!isOpen} />
          ) : view === "rounds" ? (
            <RoundsView
              snapshot={snapshot}
              entries={entries}
              justConfirmedRoundId={justConfirmed}
              onOpenRound={() => void openRound()}
              onCorrect={correct}
              onRemoveCorrection={(correctionId, dishName) => void mutate({ kind: "removeCorrection", correctionId, dishName })}
              onClose={() => void closeOrder()}
            />
          ) : view === "people" ? (
            <PeopleView
              snapshot={snapshot}
              entries={roundEntries}
              canClaim={!isHost && isOpen}
              onClaim={(entry) => void mutate({ kind: "claim", batchId: entry.batchId, dishName: entry.dishName })}
              onRemoveDuplicate={(entry) => actions.remove(entry)}
            />
          ) : (
            <GroupsView snapshot={snapshot} entries={roundEntries} onSetMembers={(label, memberIds) => void mutate({ kind: "groupMembers", label, memberIds })} />
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
            {isOpen && isHost ? (
              <Button onClick={() => setMode("review")} disabled={total === 0 && correctionsThisRound === 0}>
                <ReceiptText className="size-5" aria-hidden />
                Review order
              </Button>
            ) : isOpen || confirmedTicket ? (
              <Button variant="outline" onClick={() => setMode("waiter")} disabled={!confirmedTicket && total === 0 && correctionsThisRound === 0}>
                <ReceiptText className="size-5" aria-hidden />
                Ticket
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {mode === "review" && isOpen ? (
        <ReviewPanel
          snapshot={snapshot}
          entries={roundEntries}
          ticket={ticket}
          roundId={round.id}
          unsaved={unsaved}
          notSaved={failed.length}
          onBack={() => setMode("edit")}
          onShowWaiter={() => setMode("waiter")}
          onConfirm={() => void confirmRound()}
          onRemoveDuplicate={(entry) => actions.remove(entry)}
        />
      ) : null}
      {mode === "waiter" ? (
        <WaiterPanel
          ticket={confirmedTicket ?? ticket}
          confirmed={Boolean(confirmedTicket)}
          justConfirmed={justConfirmed === round.id}
          canConfirm={isHost && isOpen && unsaved === 0 && failed.length === 0}
          onBack={() => {
            setMode(isHost && isOpen ? "review" : "edit");
            setJustConfirmed(null);
          }}
          onConfirm={() => void confirmRound()}
        />
      ) : null}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
