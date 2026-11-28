import { ArrowRight, Check, Contrast } from "lucide-react";
import { Button } from "@/components/ui/button";
import { keepDots, stepRowText, type BillStep } from "@/lib/bill-step";
import { cn } from "@/lib/utils";

/** What's next: how many prices are still missing and the way in; once all are in, the next billing step (or "Shares are final") with a quiet way back to edit. */
export function PriceStatusRow({ left, step, onEnter, onOpenBill }: { left: number; step: BillStep | null; onEnter: () => void; onOpenBill: () => void }) {
  if (left === 0) {
    const final = (step?.isFinal ?? false) && !step?.differs;
    const Icon = final ? Check : step?.canGo === false ? Contrast : ArrowRight;
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t-[1.5px] border-dashed border-rule pt-3">
        <p className={cn("flex min-w-0 grow basis-36 items-start gap-2 font-semibold", final && "text-ok")}>
          <Icon className="mt-0.5 size-5 shrink-0" aria-hidden /> {step ? keepDots(stepRowText(step, true)) : "All prices in"}
        </p>
        <div className="flex flex-wrap items-center gap-x-3">
          {step?.canGo ? (
            <Button variant="outline" onClick={onOpenBill} aria-label={`Open bill: ${step.text}`}>
              Open bill
            </Button>
          ) : null}
          <button type="button" onClick={onEnter} className="min-h-11 cursor-pointer font-semibold text-tomato-ink underline underline-offset-2">
            Edit prices
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t-[1.5px] border-dashed border-rule pt-3">
      <p className="font-semibold">
        <span aria-hidden>₱ </span>
        {left} {left === 1 ? "price" : "prices"} left
      </p>
      <Button variant="outline" onClick={onEnter}>
        Enter prices
      </Button>
    </div>
  );
}
