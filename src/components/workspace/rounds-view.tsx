"use client";

import { Plus, Undo2, Wrench } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";
import { consolidate, preparationLabel } from "@/lib/consolidate";
import type { SessionSnapshot, SnapshotEntry } from "@/lib/snapshot";
import { correctionText, liveTicket } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { Stepper } from "./stepper";

export interface CorrectionRequest {
  sourceEntryId: string;
  dishName: string;
  type: "QUANTITY" | "REPLACE";
  quantity?: number;
  replacement?: string;
  explanation?: string;
}

interface RoundsViewProps {
  snapshot: SessionSnapshot;
  entries: SnapshotEntry[];
  justConfirmedRoundId: string | null;
  onOpenRound: () => void;
  onCorrect: (request: CorrectionRequest) => void;
  onRemoveCorrection: (id: string, dishName: string) => void;
  onClose: () => void;
}

/** One option per preparation of a confirmed round; corrections attach to its largest source entry. */
function preparationsOf(entries: SnapshotEntry[]) {
  return consolidate(entries).dishes.flatMap((dish) =>
    dish.preparations.map((p) => {
      const source = [...p.entries].sort((a, b) => b.quantity - a.quantity)[0];
      const label = dish.preparations.length > 1 || p.variant || p.instructions ? `${dish.name} · ${preparationLabel(p)}` : dish.name;
      return { key: p.key, label, dishName: dish.name, entryId: source.id, max: source.quantity, total: p.quantity };
    }),
  );
}

function CorrectionDialog({ roundNumber, entries, onCorrect }: { roundNumber: number; entries: SnapshotEntry[]; onCorrect: (r: CorrectionRequest) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const options = preparationsOf(entries);
  const [choice, setChoice] = useState(0);
  const [type, setType] = useState<"QUANTITY" | "REPLACE">("QUANTITY");
  const [quantity, setQuantity] = useState(1);
  const [replacement, setReplacement] = useState("");
  const [note, setNote] = useState("");
  const option = options[Math.min(choice, options.length - 1)];
  if (!option) return null;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setChoice(0);
          setType("QUANTITY");
          setQuantity(1);
          setReplacement("");
          setNote("");
          ref.current?.showModal();
        }}
      >
        <Wrench className="size-4" aria-hidden /> Correct a dish
      </Button>
      <dialog ref={ref} aria-labelledby={`${id}-t`} className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-[1.4rem] bg-ticket p-5 text-ink shadow-ticket backdrop:bg-ink/55">
        <form
          method="dialog"
          onSubmit={(e) => {
            if (type === "REPLACE" && !replacement.trim()) {
              e.preventDefault();
              return;
            }
            onCorrect({ sourceEntryId: option.entryId, dishName: option.dishName, type, quantity: type === "QUANTITY" ? quantity : undefined, replacement: type === "REPLACE" ? replacement : undefined, explanation: note || undefined });
          }}
        >
          <h2 id={`${id}-t`} className="text-xl">
            Correct round {roundNumber}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Confirmed dishes never change. The correction goes to the waiter with the open round.</p>
          <label htmlFor={`${id}-dish`} className="mt-4 block text-sm font-semibold">
            Dish
          </label>
          <select
            id={`${id}-dish`}
            value={choice}
            onChange={(e) => {
              setChoice(Number(e.target.value));
              setQuantity(1);
            }}
            className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base"
          >
            {options.map((o, i) => (
              <option key={o.key} value={i}>
                {o.label} ×{o.total}
              </option>
            ))}
          </select>
          <fieldset className="mt-4">
            <legend className="text-sm font-semibold">What changed?</legend>
            <div className="mt-1.5 flex gap-1.5" role="radiogroup">
              {(["QUANTITY", "REPLACE"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  onClick={() => setType(t)}
                  className={cn("min-h-10 cursor-pointer rounded-full border-[1.5px] px-3.5 text-sm font-semibold", type === t ? "border-ink bg-ink text-paper" : "border-input bg-ticket")}
                >
                  {t === "QUANTITY" ? "Cancel some" : "Change it"}
                </button>
              ))}
            </div>
          </fieldset>
          {type === "QUANTITY" ? (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm">How many to cancel</span>
              <Stepper value={quantity} label={`${option.label} to cancel`} max={option.max} onChange={setQuantity} />
            </div>
          ) : (
            <div className="mt-3">
              <label htmlFor={`${id}-to`} className="text-sm font-semibold">
                Change it to
              </label>
              <input id={`${id}-to`} value={replacement} onChange={(e) => setReplacement(e.target.value)} maxLength={60} placeholder="Large, no ice, Pork instead…" className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base" />
            </div>
          )}
          <label htmlFor={`${id}-note`} className="mt-3 block text-sm font-semibold">
            Note for the waiter <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base" />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
            <Button type="submit">Add correction</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Round history (brief 5.3, 5.15): each confirmed round on its own carbon copy, stamped; corrections; end session. */
export function RoundsView({ snapshot, entries, justConfirmedRoundId, onOpenRound, onCorrect, onRemoveCorrection, onClose }: RoundsViewProps) {
  const isHost = snapshot.me.role === "HOST";
  const isOpen = snapshot.session.status === "OPEN";
  const draft = snapshot.rounds.find((r) => r.status === "DRAFT");
  const last = snapshot.rounds[snapshot.rounds.length - 1];
  const rounds = [...snapshot.rounds].reverse();

  return (
    <div className="space-y-5">
      {isHost && isOpen && !draft ? (
        <Button size="lg" className="w-full" onClick={onOpenRound}>
          <Plus className="size-5" aria-hidden /> Start round {last.number + 1}
        </Button>
      ) : null}

      {rounds.map((round) => {
        if (round.status === "DRAFT") {
          const roundEntries = entries.filter((e) => e.roundId === round.id);
          const ticket = liveTicket({ roundNumber: round.number, title: snapshot.session.title, ticket: consolidate(roundEntries), corrections: snapshot.corrections, roundId: round.id });
          const corrections = snapshot.corrections.filter((c) => c.targetRoundId === round.id);
          return (
            <div key={round.id} className="space-y-2">
              <WaiterTicket ticket={ticket} size="compact" />
              {corrections.length && isHost && isOpen ? (
                <ul className="space-y-1 px-1" aria-label={`Corrections going out with round ${round.number}`}>
                  {corrections.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-ink-soft">{correctionText(c)}</span>
                      <button type="button" onClick={() => onRemoveCorrection(c.id, c.dishName)} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-full px-3 font-semibold hover:bg-ink/6">
                        <Undo2 className="size-4" aria-hidden /> Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        }
        const ticket = snapshot.tickets[round.id];
        if (!ticket) return null;
        const roundEntries = entries.filter((e) => e.roundId === round.id);
        return (
          <div key={round.id} className="space-y-2">
            <WaiterTicket ticket={ticket} size="compact" confirmed justConfirmed={round.id === justConfirmedRoundId} />
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <span className="text-sm text-ink-soft">
                Confirmed {round.confirmedAt ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(round.confirmedAt)) : ""}
              </span>
              {isHost && isOpen && draft && roundEntries.length ? <CorrectionDialog roundNumber={round.number} entries={roundEntries} onCorrect={onCorrect} /> : null}
            </div>
            {isHost && isOpen && !draft && roundEntries.length ? <p className="px-1 text-sm text-ink-soft">To correct this round, start a new round first.</p> : null}
          </div>
        );
      })}

      {isHost && isOpen ? (
        <div className="border-t-[1.5px] border-dashed border-rule pt-5">
          <ConfirmDialog
            danger
            title="End this order?"
            body={
              <>
                <p>Nobody can add or change anything after this, and the invite stops working.</p>
                <p>Everyone can still look at the tickets for 7 days. Then the order is deleted.</p>
                {draft && entries.some((e) => e.roundId === draft.id) ? <p className="font-semibold text-ink">Round {draft.number} was never confirmed with the waiter.</p> : null}
              </>
            }
            confirmLabel="End order"
            onConfirm={onClose}
            trigger={(open) => (
              <Button variant="danger" className="w-full" onClick={open}>
                End order
              </Button>
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
