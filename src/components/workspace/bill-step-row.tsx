"use client";

import { ArrowRight, CircleCheck, Contrast } from "lucide-react";
import { Button } from "@/components/ui/button";
import { keepDots, stepRowText, type BillStep, type BillStepId } from "@/lib/bill-step";
import { cn } from "@/lib/utils";

const BLOCKS: Partial<Record<BillStepId, string>> = { service: "kkb-service", review: "kkb-review", adjustment: "kkb-adjustments", receipt: "kkb-receipt" };

function bringIntoView(el: HTMLElement | null | undefined, open?: HTMLElement | null) {
  const card = el?.closest("details");
  if (card) card.open = true;
  const target = open ?? el;
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: "start" });
}

/** Where a next step lives in the KKB tab: the first dish without a payer, a block, or the first card still owing. The Prices sheet is opened by the caller. */
export function jumpToStep(id: BillStepId) {
  if (id === "payers") return bringIntoView(document.querySelector<HTMLElement>("[data-unbilled]"));
  if (id === "payments") {
    const card = document.querySelector<HTMLElement>("[data-unpaid]");
    return bringIntoView(card, card?.querySelector<HTMLElement>("[data-record-payment]"));
  }
  const block = BLOCKS[id];
  if (block) bringIntoView(document.getElementById(block));
}

/** One line at the top of the KKB tab: what the host does next, what everyone else is waiting on, or that shares are final. Not a live region: realtime updates would chatter. */
export function BillStepRow({ step, isHost }: { step: BillStep; isHost: boolean }) {
  const done = step.isFinal && !(isHost && step.differs);
  const Icon = done ? CircleCheck : isHost && step.canGo ? ArrowRight : Contrast;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2.5 text-sm text-ink", done ? "bg-ok-wash" : "bg-saffron-wash")}>
      <p className="flex min-w-0 grow basis-36 items-start gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", done && "text-ok")} aria-hidden />
        <span className="font-semibold">{keepDots(stepRowText(step, isHost))}</span>
      </p>
      {isHost && step.canGo ? (
        <Button variant="outline" className="ml-auto" onClick={() => jumpToStep(step.id)} aria-label={`Go: ${step.text}`}>
          Go
        </Button>
      ) : null}
    </div>
  );
}
