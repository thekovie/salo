"use client";

import { ChevronLeft, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useRovingRadio } from "@/hooks/use-roving-radio";
import { allocateCancel, dishRemaining, prepPeople, type Prep } from "@/lib/corrections";
import type { SessionSnapshot, SnapshotEntry } from "@/lib/snapshot";
import { focusFirst, focusIsLost } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { DishPicker } from "./dish-picker";
import { Stepper } from "./stepper";

export interface CorrectionRequest {
  dishName: string;
  entries: { sourceEntryId: string; quantity?: number }[];
  type: "QUANTITY" | "REPLACE";
  replacement?: string;
  explanation?: string;
}

interface CorrectionSheetProps {
  /** The confirmed round whose dishes can be changed (null = closed). */
  round: { roundNumber: number; preps: Prep[]; /** Open straight on this line (from Served). */ pickKey?: string } | null;
  onClose: () => void;
  /** Where focus goes when the sheet closes (the drawer would leave it on the page body). */
  onReturnFocus: () => void;
  snapshot: SessionSnapshot;
  entries: SnapshotEntry[];
  /** Next round to start when none is open. */
  nextRound: number;
  draftNumber: number | null;
  onStartRound: () => void;
  onSave: (request: CorrectionRequest) => void;
  /** Resolves to an error message, or null when done. */
  onUnavailable: (dishId: string, dishName: string, replacement: string) => Promise<string | null>;
}

const TABS = ["Cancel some", "Replace", "Unavailable"] as const;
const REPLACEMENT_TABS = TABS.slice(0, 2);
const field = "mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base";

export function CorrectionSheet(props: CorrectionSheetProps) {
  return (
    <Drawer open={props.round !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DrawerContent
        data-ph-mask=""
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onReturnFocus();
        }}
      >{props.round ? <Flow key={props.round.roundNumber} {...props} round={props.round} /> : null}</DrawerContent>
    </Drawer>
  );
}

/** One drawer, two steps: pick the dish line, then change it. */
function Flow(props: CorrectionSheetProps & { round: NonNullable<CorrectionSheetProps["round"]> }) {
  const { round, onClose } = props;
  const [pickedKey, setPicked] = useState<string | null>(round.pickKey ?? null);
  const root = useRef<HTMLDivElement>(null);
  const settled = useRef(false);
  const prep = round.preps.find((p) => p.key === pickedKey && p.left > 0);
  // After the first paint: the form went away (saved, reached 0, or changed live), so land on the list instead of the page.
  useLayoutEffect(() => {
    if (settled.current && focusIsLost()) focusFirst([...(root.current?.querySelectorAll("[data-pick]") ?? []), root.current?.querySelector("button")]);
    settled.current = true;
  });
  return (
    <div ref={root}>
      {prep ? (
        <Body {...props} target={{ roundNumber: round.roundNumber, prep }} onBack={() => setPicked(null)} onClose={onClose} />
      ) : (
        <DishPicker roundNumber={round.roundNumber} preps={round.preps} onPick={(p) => setPicked(p.key)} />
      )}
    </div>
  );
}

function Body({ target, onBack, onClose, snapshot, entries, nextRound, draftNumber, onStartRound, onSave, onUnavailable }: CorrectionSheetProps & { target: { roundNumber: number; prep: Prep }; onBack: () => void }) {
  const { prep, roundNumber } = target;
  const id = useId();
  const [tab, setTab] = useState(0);
  const tabs = prep.kind === "replacement" ? REPLACEMENT_TABS : TABS;
  const radio = useRovingRadio(tabs.length, tab, setTab);
  const people = prepPeople(prep);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [replacement, setReplacement] = useState("");
  const [outReplacement, setOutReplacement] = useState("");
  const [note, setNote] = useState("");
  const chosen = people.filter((p) => (counts[p.key] ?? 0) > 0);
  const total = chosen.reduce((sum, p) => sum + counts[p.key], 0);
  const remaining = dishRemaining(prep.dishId, entries, snapshot);

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (tab === 0 && total > 0) {
      onSave({ dishName: prep.label, type: "QUANTITY", entries: allocateCancel(people, counts), explanation: note || undefined });
    } else if (tab === 1 && replacement.trim()) {
      onSave({ dishName: prep.label, type: "REPLACE", entries: prep.entries.filter((e) => e.left > 0).map((e) => ({ sourceEntryId: e.entryId })), replacement, explanation: note || undefined });
    } else return;
    onClose();
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full px-2 text-sm font-semibold hover:bg-ink/6">
            <ChevronLeft className="size-4" aria-hidden /> All dishes
          </button>
          <DrawerTitle className="font-display text-2xl font-medium">Change {prep.label}</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-ink-soft">
            Round {roundNumber} · {prep.ordered} ordered
          </DrawerDescription>
        </div>
        <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
          <X className="size-5" aria-hidden />
        </DrawerClose>
      </div>
      <div className="mt-4 flex gap-1.5" role="radiogroup" aria-label="What changed?">
        {tabs.map((label, i) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={tab === i}
            {...radio(i)}
            onClick={() => setTab(i)}
            className={cn("min-h-11 flex-1 cursor-pointer rounded-full border-[1.5px] px-2 text-sm font-semibold", tab === i ? "border-ink bg-ink text-paper" : "border-input bg-ticket")}
          >
            {label}
          </button>
        ))}
      </div>

      {prep.kind === "replacement" ? <p className="mt-2 text-sm text-ink-soft">Not available? Cancel it instead.</p> : null}

      {tab === 2 && remaining === 0 ? (
        <p className="mt-4">Nothing of {prep.dishName} is left to take off.</p>
      ) : tab === 2 ? (
        <div className="mt-4">
          <p>
            The waiter said it&rsquo;s out. All {remaining} {prep.dishName}, every size, come off now.
          </p>
          <label htmlFor={`${id}-out`} className="mt-3 block text-sm font-semibold">
            Replace with… <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input id={`${id}-out`} value={outReplacement} onChange={(e) => setOutReplacement(e.target.value)} maxLength={60} placeholder="Pork Sisig instead…" className={field} />
          <div className="mt-5 grid">
            <ConfirmDialog
              danger
              title={`Mark ${prep.dishName} unavailable?`}
              body={<p>Confirmed dishes come off now. This can&rsquo;t be undone.</p>}
              confirmLabel="Mark unavailable"
              dismissLabel="Not now"
              busyLabel="Marking…"
              onConfirm={async () => {
                const failure = await onUnavailable(prep.dishId, prep.dishName, outReplacement);
                if (!failure) onClose();
                return failure;
              }}
              trigger={(open) => (
                <Button type="button" variant="danger" onClick={open}>
                  Mark unavailable
                </Button>
              )}
            />
          </div>
        </div>
      ) : draftNumber === null ? (
        <div className="mt-4 space-y-3">
          <p className="text-ink-soft">Start round {nextRound} to send changes to the waiter.</p>
          <Button type="button" className="w-full" onClick={onStartRound}>
            Start round {nextRound}
          </Button>
        </div>
      ) : (
        <form onSubmit={save} noValidate className="mt-4">
          {tab === 0 ? (
            <div>
              <div className="text-sm font-semibold">Whose?</div>
              <ul className="mt-1 divide-y divide-ink/10">
                {people.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-2">
                    <span className="text-base">
                      {p.who} <span className="text-sm text-ink-soft">ordered {p.ordered}</span>
                    </span>
                    <Stepper value={counts[p.key] ?? 0} min={0} max={p.left} disabled={p.left === 0} label={`${prep.label} to cancel for ${p.who}`} onChange={(n) => setCounts((c) => ({ ...c, [p.key]: n }))} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <label htmlFor={`${id}-to`} className="text-sm font-semibold">
                Change it to
              </label>
              <input id={`${id}-to`} value={replacement} onChange={(e) => setReplacement(e.target.value)} maxLength={60} placeholder="Large, no ice, Pork instead…" className={field} />
            </div>
          )}
          <label htmlFor={`${id}-note`} className="mt-3 block text-sm font-semibold">
            Note for the waiter <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} className={field} />
          <p className="mt-3 text-sm text-ink-soft">Goes to the waiter with round {draftNumber}</p>
          <p className="mt-4 text-sm font-semibold" aria-live="polite">
            {tab === 0 ? `Cancels: ${chosen.length ? chosen.map((p) => `${p.who} ×${counts[p.key]}`).join(", ") : "nobody yet"}` : null}
          </p>
          <div className="mt-2 grid">
            <Button type="submit" disabled={tab === 0 ? total === 0 : !replacement.trim()}>
              Save change
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
