"use client";

import { Plus, Wrench } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";
import { consolidate, preparationLabel } from "@/lib/consolidate";
import type { SessionSnapshot, SnapshotEntry } from "@/lib/snapshot";
import { liveTicket } from "@/lib/ticket";
import { cn } from "@/lib/utils";
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
}

/** One option per preparation of a confirmed round; corrections attach to its largest source entry. */
function preparationsOf(entries: SnapshotEntry[], corrections: SessionSnapshot["corrections"]) {
  const cancelled = (entryId: string) =>
    corrections.filter((c) => c.sourceEntryId === entryId && c.type === "QUANTITY").reduce((sum, c) => sum + Math.abs(c.quantityDelta ?? 0), 0);
  return consolidate(entries).dishes.flatMap((dish) =>
    dish.preparations.flatMap((p) => {
      const sources = p.entries.map((e) => ({ id: e.id, left: e.quantity - cancelled(e.id) })).sort((a, b) => b.left - a.left);
      const source = sources[0];
      const label = dish.preparations.length > 1 || p.variant || p.instructions ? `${dish.name} · ${preparationLabel(p)}` : dish.name;
      const left = sources.reduce((sum, x) => sum + Math.max(0, x.left), 0);
      return source ? [{ key: p.key, label, dishName: dish.name, entryId: source.id, max: Math.max(0, source.left), left }] : [];
    }),
  );
}

function CorrectionDialog({ roundNumber, entries, corrections, onCorrect }: { roundNumber: number; entries: SnapshotEntry[]; corrections: SessionSnapshot["corrections"]; onCorrect: (r: CorrectionRequest) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const options = preparationsOf(entries, corrections);
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
          setOpen(true);
        }}
      >
        <Wrench className="size-4" aria-hidden /> Correct a dish
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if ((type === "REPLACE" && !replacement.trim()) || (type === "QUANTITY" && option.max === 0)) return;
            setOpen(false);
            onCorrect({ sourceEntryId: option.entryId, dishName: option.dishName, type, quantity: type === "QUANTITY" ? Math.min(quantity, option.max) : undefined, replacement: type === "REPLACE" ? replacement : undefined, explanation: note || undefined });
          }}
        >
          <DrawerTitle className="font-display text-xl font-medium">Correct round {roundNumber}</DrawerTitle>
          <DrawerDescription className="mt-1 text-sm text-ink-soft">Confirmed dishes never change. The correction goes to the waiter with the open round.</DrawerDescription>
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
                {o.label} ×{o.left}
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
            option.max > 0 ? (
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">How many to cancel</span>
                  <Stepper value={Math.min(quantity, option.max)} label={`${option.label} to cancel`} max={option.max} onChange={setQuantity} />
                </div>
                {option.max < option.left ? <p className="text-xs text-ink-soft">Up to {option.max} at a time (it was ordered in parts). Add another correction for more.</p> : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">All of this dish is already cancelled.</p>
            )
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
            <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add correction</Button>
          </div>
        </form>
        </DrawerContent>
      </Drawer>
    </>
  );
}

/** Round history (brief 5.3, 5.15): each confirmed round on its own carbon copy, stamped; corrections. Ending the order lives in the header's order options. */
export function RoundsView({ snapshot, entries, justConfirmedRoundId, onOpenRound, onCorrect, onRemoveCorrection }: RoundsViewProps) {
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
              <WaiterTicket
                ticket={ticket}
                size="compact"
                removableCorrections={isHost && isOpen ? corrections.map((c) => ({ id: c.id, onRemove: () => onRemoveCorrection(c.id, c.dishName) })) : undefined}
              />
              {!isOpen ? <p className="px-1 text-sm text-ink-soft">Never confirmed with the waiter.</p> : null}
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
              {isHost && isOpen && draft && roundEntries.length ? <CorrectionDialog roundNumber={round.number} entries={roundEntries} corrections={snapshot.corrections} onCorrect={onCorrect} /> : null}
            </div>
            {isHost && isOpen && !draft && roundEntries.length ? <p className="px-1 text-sm text-ink-soft">To correct this round, start a new round first.</p> : null}
          </div>
        );
      })}

    </div>
  );
}
