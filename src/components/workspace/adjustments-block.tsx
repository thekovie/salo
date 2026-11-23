"use client";

import { CircleAlert, Pencil, Plus } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { percentLabel } from "@/lib/adjustments";
import type { Kkb } from "@/lib/kkb";
import { formatPeso } from "@/lib/money";
import type { SessionSnapshot } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { AdjustmentSheet } from "./adjustment-sheet";

interface AdjustmentsBlockProps {
  kkb: Kkb;
  snapshot: SessionSnapshot;
  refresh: () => Promise<unknown>;
  isHost: boolean;
}

/** Receipt discounts and extra charges: everyone sees them, only the host adds or edits. Hidden from guests when there are none. */
export function AdjustmentsBlock({ kkb, snapshot, refresh, isHost }: AdjustmentsBlockProps) {
  const id = useId();
  const [sheet, setSheet] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  if (!isHost && kkb.adjustments.length === 0) return null;
  const existing = snapshot.settlement.adjustments.find((a) => a.id === sheet.id) ?? null;
  const stored = new Map(snapshot.settlement.adjustments.map((a) => [a.id, a.percentBps]));
  const open = (adjustmentId: string | null) => setSheet({ open: true, id: adjustmentId });

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl bg-paper p-4" id="kkb-adjustments">
      <h3 id={`${id}-title`} className="text-lg">
        Discounts and extras
      </h3>
      {kkb.adjustments.length === 0 ? <p className="mt-1 text-sm text-ink-soft">Senior or PWD discount, a promo, or a charge the receipt shows.</p> : null}
      <ul className="mt-2 divide-y-[1.5px] divide-dashed divide-rule">
        {kkb.adjustments.map((a) => (
          <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 py-2">
            <p className="break-words">{a.title}</p>
            <div className="flex items-center gap-1">
              <span className="tally">{`${a.direction === "discount" ? "−" : "+"}${a.amountCentavos != null ? formatPeso(a.amountCentavos) : percentLabel(stored.get(a.id) ?? 0)}`}</span>
              {isHost ? (
                <button type="button" onClick={() => open(a.id)} aria-label={`Edit ${a.title}`} className="-my-2.5 inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
                  <Pencil className="size-4 text-ink-soft" aria-hidden />
                </button>
              ) : null}
            </div>
            {a.detail || a.state === "flagged" ? (
              <p className={cn("col-span-full flex items-start gap-1 text-sm", a.state === "flagged" ? "text-bad" : a.state === "applied" ? "text-ink-soft" : "text-ink")}>
                {a.state !== "applied" ? <CircleAlert className={cn("mt-0.5 size-4 shrink-0", a.state !== "flagged" && "text-saffron-ink")} aria-hidden /> : null}
                {a.state === "flagged" ? a.problems.join(" ") : a.detail}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {isHost ? (
        <Button variant="outline" className="mt-2" onClick={() => open(null)}>
          <Plus className="size-5" aria-hidden />
          Add discount or charge
        </Button>
      ) : null}
      {isHost ? <AdjustmentSheet key={sheet.id ?? "new"} open={sheet.open} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} existing={existing} snapshot={snapshot} refresh={refresh} /> : null}
    </section>
  );
}
