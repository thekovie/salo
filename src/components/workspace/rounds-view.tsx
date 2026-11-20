"use client";

import { ChevronDown, Plus, ReceiptText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";
import { consolidate } from "@/lib/consolidate";
import { preparationsOfRound, visiblePreps } from "@/lib/corrections";
import { confirmedIds } from "@/lib/effective-order";
import { focusWhenFree } from "@/lib/focus";
import { everyone, type SessionSnapshot, type SnapshotEntry } from "@/lib/snapshot";
import { liveTicket } from "@/lib/ticket";
import { LocalTime } from "@/components/ui/local-time";
import { CorrectionSheet, type CorrectionRequest } from "./correction-sheet";
import { CorrectionsList } from "./corrections-list";

interface RoundsViewProps {
  snapshot: SessionSnapshot;
  entries: SnapshotEntry[];
  justConfirmedRoundId: string | null;
  /** `stay`: start the round without leaving the Rounds tab (the correction sheet stays open). */
  onOpenRound: (options?: { stay?: boolean }) => void;
  onCorrect: (request: CorrectionRequest) => void;
  onUnavailable: (dishId: string, dishName: string, replacement: string) => Promise<string | null>;
  onRemoveCorrection: (id: string, dishName: string) => void;
  /** Host: end (or cancel) the order. */
  onEnd?: () => void;
  /** Open KKB (prices and service charge) in "Who ordered what". */
  onKkb?: () => void;
}

/** Round history (brief 5.3, 5.15): each confirmed round on its own carbon copy, stamped; corrections. Ending the order lives in the header's order options. */
export function RoundsView({ snapshot, entries, justConfirmedRoundId, onOpenRound, onCorrect, onUnavailable, onRemoveCorrection, onEnd, onKkb }: RoundsViewProps) {
  const [changing, setChanging] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const changeButton = useRef<HTMLElement | null>(null);
  const changedRound = useRef<string | null>(null);
  const people = everyone(snapshot);
  const isHost = snapshot.me.role === "HOST";
  const isOpen = snapshot.session.status === "OPEN";
  const draft = snapshot.rounds.find((r) => r.status === "DRAFT");
  const last = snapshot.rounds[snapshot.rounds.length - 1];
  const rounds = [...snapshot.rounds].reverse();
  const changed = snapshot.rounds.find((r) => r.id === changing);
  const confirmed = confirmedIds(snapshot.rounds);
  const prepsOf = (roundId: string) => visiblePreps(preparationsOfRound(entries.filter((e) => e.roundId === roundId), snapshot.corrections, people, confirmed));
  const changingRound = changed ? { roundNumber: changed.number, preps: prepsOf(changed.id) } : null;
  // Nothing left to change (a save or a live update emptied the round): close the sheet.
  if (changing && changingRound && !changingRound.preps.some((p) => p.kind !== "replaced")) setChanging(null);
  const returnFocus = () => focusWhenFree(() => [changeButton.current, document.getElementById(`summary-${changedRound.current}`)]);
  const wasChanging = useRef(false);
  // The drawer's own close callback can be skipped when it unmounts mid-animation, so also return focus on close.
  useEffect(() => {
    if (wasChanging.current && !changing) returnFocus();
    wasChanging.current = changing !== null;
  });

  return (
    <div className="space-y-5" data-ph-mask="">
      {isHost && isOpen && !draft ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" variant="outline" onClick={() => onOpenRound()}>
            <Plus className="size-5" aria-hidden /> Start round {last.number + 1}
          </Button>
          {onEnd ? (
            <Button size="lg" variant="outline" onClick={onEnd}>
              End the order
            </Button>
          ) : null}
        </div>
      ) : null}

      {onKkb ? (
        <button type="button" onClick={onKkb} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 font-semibold text-ink hover:bg-ink/6">
          <ReceiptText className="size-4" aria-hidden />
          KKB &amp; service charge
        </button>
      ) : null}

      {rounds.map((round) => {
        if (round.status === "DRAFT") {
          const roundEntries = entries.filter((e) => e.roundId === round.id);
          const ticket = liveTicket({ roundNumber: round.number, title: snapshot.session.title, ticket: consolidate(roundEntries), corrections: snapshot.corrections, roundId: round.id, confirmed: confirmedIds(snapshot.rounds) });
          return (
            <div key={round.id} className="space-y-2">
              <WaiterTicket ticket={ticket} size="compact" />
              {!isOpen ? <p className="px-1 text-sm text-ink-soft">Never confirmed with the waiter.</p> : null}
            </div>
          );
        }
        const ticket = snapshot.tickets[round.id];
        if (!ticket) return null;
        const canChange = prepsOf(round.id).some((p) => p.kind !== "replaced");
        const isExpanded = expanded.has(round.id);
        const items = ticket.dishes.reduce((sum, d) => sum + d.quantity, 0);
        return (
          <div key={round.id} className="space-y-2">
            <button
              type="button"
              aria-expanded={isExpanded}
              id={`summary-${round.id}`}
              aria-controls={`ticket-${round.id}`}
              onClick={() => setExpanded((open) => new Set(isExpanded ? [...open].filter((id) => id !== round.id) : [...open, round.id]))}
              className="-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] cursor-pointer items-center justify-between gap-2 rounded-xl px-1 text-left hover:bg-ink/6"
            >
              <span className="py-1">
                <span className="block">
                  <span className="font-semibold">Round {round.number}</span> · Confirmed {round.confirmedAt ? <LocalTime iso={round.confirmedAt} /> : null}
                </span>
                <span className="sr-only"> · </span>
                <span className="block text-sm text-ink-soft">
                  {ticket.dishes.length} {ticket.dishes.length === 1 ? "dish" : "dishes"} · {items} {items === 1 ? "item" : "items"}
                </span>
              </span>
              <ChevronDown className={`size-5 shrink-0 ${isExpanded ? "rotate-180" : ""}`} aria-hidden />
            </button>
            <div id={`ticket-${round.id}`} hidden={!isExpanded}>
              {isExpanded ? <WaiterTicket ticket={ticket} size="compact" confirmed justConfirmed={round.id === justConfirmedRoundId} /> : null}
            </div>
            {isHost && isOpen && canChange ? (
              <Button
                variant="outline"
                onClick={(event) => {
                  changeButton.current = event.currentTarget;
                changedRound.current = round.id;
                  setChanging(round.id);
                }}
              >
                Change a dish…<span className="sr-only">, round {round.number}</span>
              </Button>
            ) : null}
          </div>
        );
      })}

      <CorrectionsList snapshot={snapshot} onRemove={isHost && isOpen ? onRemoveCorrection : undefined} />
      <CorrectionSheet
        round={changingRound}
        onReturnFocus={returnFocus}
        onClose={() => setChanging(null)}
        snapshot={snapshot}
        entries={entries}
        draftNumber={draft?.number ?? null}
        nextRound={last.number + 1}
        onStartRound={() => onOpenRound({ stay: true })}
        onSave={onCorrect}
        onUnavailable={onUnavailable}
      />
    </div>
  );
}
