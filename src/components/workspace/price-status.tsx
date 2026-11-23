import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The host dock's button text while prices are missing; it replaces "My share" and opens the Prices sheet. */
export const enterPricesLabel = (left: number) => `Enter prices · ${left} left`;

/** What's next: how many prices are still missing and the way in, or "All prices in" with a quiet way back to edit. */
export function PriceStatusRow({ left, onEnter }: { left: number; onEnter: () => void }) {
  if (left === 0) {
    return (
      <div className="mt-3 flex items-center justify-between gap-3 border-t-[1.5px] border-dashed border-rule pt-3">
        <p className="flex items-center gap-2 font-semibold text-ok">
          <Check className="size-5" aria-hidden /> All prices in
        </p>
        <button type="button" onClick={onEnter} className="min-h-11 cursor-pointer font-semibold text-tomato-ink underline underline-offset-2">
          Edit prices
        </button>
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
