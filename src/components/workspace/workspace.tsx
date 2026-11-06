"use client";

import { CircleCheck, Hand, Lock, Plus, ReceiptText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";
import { Button } from "@/components/ui/button";
import { describeOp, useSession, type AddInput, type OverlayEntry } from "@/hooks/use-session";
import { consolidate } from "@/lib/consolidate";
import { arrivalsBetween, type Arrival } from "@/lib/arrivals";
import { everyone, type SessionSnapshot } from "@/lib/snapshot";
import { normalizeText } from "@/lib/dish-name";
import { liveTicket } from "@/lib/ticket";
import { withViewTransition } from "@/lib/view-transition";
import { Ticker } from "@/components/motion/ticker";
import { LocalTime } from "@/components/ui/local-time";
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
import { ArrivalPills, ARRIVAL_MS } from "./arrival-pills";
import { OrderOptionsSheet } from "./order-options-sheet";
import { SessionHeader } from "./session-header";
import { Toasts, useToasts } from "./toasts";

/** Refusals that may succeed on a second try (server hiccup, too fast); conflicts and permissions will not. */
const isRetryable = (code?: string) => code === "INTERNAL" || code === "RATE_LIMITED" || code === "UNKNOWN";

const copyFor = (roundNumber: number): 1 | 2 | 3 => (roundNumber >= 3 ? 3 : roundNumber === 2 ? 2 : 1);

export function Workspace({ initial, appUrl, justJoined = false }: { initial: SessionSnapshot; appUrl: string; justJoined?: boolean }) {
  const { snapshot, entries, pending, failed, sync, mutate, dismiss, retry, entryById } = useSession(initial);
  const { toasts, show, dismiss: dismissToast } = useToasts();
  const round = snapshot.rounds.find((r) => r.id === snapshot.activeRoundId) ?? snapshot.rounds[0];
  const roundEntries = useMemo(() => entries.filter((e) => e.roundId === round.id), [entries, round.id]);
  const total = consolidate(roundEntries).totalItems;
  const isHost = snapshot.me.role === "HOST";
  // Names for every dish, including ones marked for a guest the host has since removed.
  const people = useMemo(() => everyone(snapshot), [snapshot]);
  const sessionOpen = snapshot.session.status === "OPEN";
  const isOpen = sessionOpen && round.status === "DRAFT";
  const unsaved = pending.filter((p) => p.status !== "failed").length;
  // Ended before anything reached the waiter = the table called it off.
  const anyConfirmed = snapshot.rounds.some((r) => r.status === "CONFIRMED");
  const ended = sessionOpen ? null : anyConfirmed ? "ended" : "cancelled";
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Someone else's new dishes, noticed when a newer snapshot arrives (compared during render, React's "previous
  // value" pattern), shown as pills for a moment and tagged on their rows.
  const [seenEntries, setSeenEntries] = useState(snapshot.entries);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  if (snapshot.entries !== seenEntries) {
    const nameOf = (id: string) => people.find((p) => p.id === id)?.displayName ?? "Someone";
    const fresh = arrivalsBetween(seenEntries, snapshot.entries, snapshot.me.participantId, nameOf);
    setSeenEntries(snapshot.entries);
    if (fresh.length > 0) setArrivals((list) => [...list, ...fresh].slice(-4));
  }
  // Each pill leaves on its own clock, however many arrive after it.
  const arrivalTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = arrivalTimers.current;
    for (const a of arrivals) {
      if (timers.has(a.key)) continue;
      timers.set(
        a.key,
        setTimeout(() => {
          timers.delete(a.key);
          setArrivals((list) => list.filter((x) => x.key !== a.key));
        }, ARRIVAL_MS),
      );
    }
  }, [arrivals]);
  useEffect(() => {
    const timers = arrivalTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);
  const recent = useMemo(() => new Map(arrivals.map((a) => [a.dishId, { key: a.key, label: `+${a.quantity} · ${a.who}` }])), [arrivals]);
  function jumpTo(arrival: Arrival) {
    setArrivals((list) => list.filter((a) => a.key !== arrival.key));
    const name = snapshot.entries.find((e) => e.dishId === arrival.dishId)?.dishName;
    if (!name) return;
    setView("order");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => document.querySelector(`[data-dish="${CSS.escape(normalizeText(name))}"]`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }));
  }

  const [view, setView] = useState<View>(sessionOpen ? "order" : "rounds");
  const [justConfirmed, setJustConfirmed] = useState<string | null>(null);
  // A panel belongs to the round it was opened for: if the round changes underneath (confirmed or started on another
  // device), it closes instead of silently showing something else. The host's own confirmation keeps the stamped ticket.
  const roundKey = `${round.id}:${round.status}`;
  const [modeState, setModeState] = useState<{ mode: "edit" | "review" | "waiter"; key: string }>({ mode: "edit", key: roundKey });
  const mode = modeState.key === roundKey || justConfirmed === round.id ? modeState.mode : "edit";
  const setMode = (next: "edit" | "review" | "waiter") => setModeState({ mode: next, key: roundKey });
  // First visit after joining: one short tip, then the address loses its ?joined=1.
  useEffect(() => {
    if (!justJoined) return;
    show({ message: "You’re in! Add your dishes below. Only you can change yours." });
    window.history.replaceState(null, "", window.location.pathname);
  }, [justJoined, show]);

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

  // One-tap choices for "who's it for": people with a phone, names typed for people without one, groups used so far.
  const recipients = useMemo(() => {
    const people = snapshot.participants.filter((p) => p.id !== snapshot.me.participantId);
    const taken = new Set(snapshot.participants.map((p) => normalizeText(p.displayName)));
    const uniq = (labels: string[]) => [...new Map(labels.map((l) => [normalizeText(l), l])).values()];
    const names = uniq(snapshot.entries.flatMap((e) => (e.attribution.type === "INDIVIDUAL" && !e.attribution.participantId && e.attribution.label ? [e.attribution.label] : []))).filter(
      (n) => !taken.has(normalizeText(n)),
    );
    const groups = uniq([...snapshot.groups.map((g) => g.label), ...snapshot.entries.flatMap((e) => (e.attribution.type === "GROUP" && e.attribution.label ? [e.attribution.label] : []))]);
    return { people, names, groups };
  }, [snapshot]);

  const add = useCallback(
    async (input: AddInput) => {
      const pendingResult = mutate({ kind: "add", input });
      // Bring the line into view above the composer (it may land below the fold).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const row = document.querySelector(`[data-dish="${CSS.escape(normalizeText(input.dishName))}"]`);
          const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
          row?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
        }),
      );
      const result = await pendingResult;
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
      // The row fades and the rest of the ticket closes the gap (View Transition where supported).
      withViewTransition(() => void mutate({ kind: "remove", entry }));
      // Queued behind the removal, so Undo can never reach the server before it.
      show({
        message: `Removed ${entry.dishName} ×${entry.quantity}.`,
        action: { label: "Undo", run: () => withViewTransition(() => void mutate({ kind: "restore", entry })) },
      });
    },
  };

  async function confirmRound(): Promise<string | null> {
    let failure = "";
    const result = await mutate(
      { kind: "confirm", roundId: round.id, roundNumber: round.number, expectedRevision: snapshot.session.revision },
      { onError: (message) => (failure = message) },
    );
    if (result) {
      setJustConfirmed(round.id);
      setModeState({ mode: "waiter", key: `${round.id}:CONFIRMED` });
      // A tiny buzz as the stamp hits the paper (Android; ignored elsewhere and with reduced motion).
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(() => navigator.vibrate?.(12), 590);
      // Let the stamp land first; the message follows it.
      setTimeout(() => show({ message: `Round ${round.number} confirmed. Kain na!` }), 900);
      return null;
    }
    return failure || "Not confirmed. Check your connection and try again.";
  }

  async function openRound() {
    const next = round.number + 1;
    if (await mutate({ kind: "openRound", roundNumber: next })) {
      setView("order");
      show({ message: `Round ${next} started. Add-ons go here.` });
    }
  }

  const correct = (request: CorrectionRequest) => void mutate({ kind: "correction", ...request });

  async function removeGuest(participantId: string, name: string, reason: string | null): Promise<boolean> {
    const accepted = Boolean(await mutate({ kind: "removeGuest", participantId, name, reason }));
    if (accepted) {
      show({ message: `${name} removed.`, action: { label: "Undo", run: () => void mutate({ kind: "restoreGuest", participantId, name }) } });
    }
    return accepted;
  }

  async function closeOrder(): Promise<boolean> {
    const accepted = Boolean(await mutate({ kind: "close" }));
    // An ended order opens on its tickets; a cancelled one has none, so it stays on the (now read-only) order.
    if (accepted && anyConfirmed) setView("rounds");
    return accepted;
  }

  return (
    <div className="min-h-dvh pb-[calc(env(safe-area-inset-bottom)+11rem)]">
      <SessionHeader
        title={snapshot.session.title}
        roundNumber={round.number}
        roundStatus={round.status}
        ended={ended}
        sync={sync}
        onOptions={isHost && sessionOpen ? () => setOptionsOpen(true) : undefined}
        actions={
          sessionOpen ? (
            <InviteSheet appUrl={appUrl} joinCode={snapshot.session.joinCode} title={snapshot.session.title} peopleCount={snapshot.participants.length} />
          ) : null
        }
      />
      {sessionOpen ? <ArrivalPills arrivals={arrivals} onSelect={jumpTo} /> : null}
      {isHost && sessionOpen ? (
        <OrderOptionsSheet
          open={optionsOpen}
          onOpenChange={setOptionsOpen}
          title={snapshot.session.title}
          anyConfirmed={anyConfirmed}
          unsentRound={round.status === "DRAFT" && roundEntries.length > 0 ? round.number : null}
          onRename={(title) => void mutate({ kind: "rename", title })}
          onEnd={closeOrder}
        />
      ) : null}

      <main className="mx-auto max-w-2xl px-3 pt-5">
        {failed.length > 0 ? (
          <div role="alert" className="mb-4 space-y-2 rounded-2xl bg-bad-wash p-3 text-bad">
            <p className="text-sm font-semibold">Not saved. The ticket shows what the order really has now.</p>
            {failed.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  <span className="font-semibold">{describeOp(item.op)}:</span> {item.error}
                </span>
                {isRetryable(item.code) ? (
                  <button type="button" onClick={() => retry(item.key)} className="min-h-11 shrink-0 cursor-pointer rounded-full border-[1.5px] border-bad px-3 font-semibold hover:bg-bad/10">
                    Retry
                  </button>
                ) : null}
                <button type="button" onClick={() => dismiss(item.key)} className="min-h-11 shrink-0 cursor-pointer rounded-full px-3 font-semibold hover:bg-bad/10">
                  Discard<span className="sr-only">: {describeOp(item.op)}</span>
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {!sessionOpen ? (
          <div role="status" className="mb-4 flex items-start gap-2.5 px-1 text-ink-soft">
            <Lock className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p>
              {ended === "cancelled" ? "This order was cancelled. Nothing was sent to the waiter." : "This order has ended. Nothing can be changed."} Everything is
              deleted on <LocalTime iso={snapshot.session.expiresAt} style="date" />.
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
            <OrderTicket entries={roundEntries} people={people} recent={recent} roundNumber={round.number} copy={copyFor(round.number)} actions={actions} readOnly={!isOpen} />
          ) : view === "rounds" ? (
            <RoundsView
              snapshot={snapshot}
              entries={entries}
              justConfirmedRoundId={justConfirmed}
              onOpenRound={() => void openRound()}
              onCorrect={correct}
              onRemoveCorrection={(correctionId, dishName) => void mutate({ kind: "removeCorrection", correctionId, dishName })}
            />
          ) : view === "people" ? (
            <PeopleView
              snapshot={snapshot}
              entries={roundEntries}
              canClaim={!isHost && isOpen}
              onClaim={(entry) => void mutate({ kind: "claim", batchId: entry.batchId, dishName: entry.dishName })}
              onRemoveDuplicate={(entry) => actions.remove(entry)}
              roundNumber={round.number}
              onRemoveGuest={isHost && sessionOpen ? removeGuest : undefined}
            />
          ) : (
            <GroupsView snapshot={snapshot} entries={roundEntries} onSetMembers={(label, memberIds) => void mutate({ kind: "groupMembers", label, memberIds })} />
          )}
        </div>
      </main>

      {sessionOpen ? (
      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-paper from-70% to-transparent pt-6 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        <div className="mx-auto max-w-2xl space-y-2 px-3">
          {isOpen ? <Composer dishNames={snapshot.dishNames} {...recipients} onAdd={(input) => void add(input)} /> : null}
          <div className="flex items-center justify-between gap-3 px-2">
            <div className="min-w-0">
              <p className="whitespace-nowrap text-ink-soft" data-testid="round-total">
                <Ticker value={total} className="tally text-xl text-ink" /> {total === 1 ? "item" : "items"}
                <span className="hidden sm:inline"> this round</span>
              </p>
              {isHost && isOpen && ready.total > 0 ? (
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
              <Button variant="outline" onClick={() => setMode("review")} disabled={total === 0 && correctionsThisRound === 0}>
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
      ) : null}

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
          onConfirm={confirmRound}
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
          onConfirm={confirmRound}
        />
      ) : null}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
