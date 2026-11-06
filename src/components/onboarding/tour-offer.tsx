"use client";

import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

/** First time in an order on this browser: a small, skippable offer of the tour. Never a modal, never in the way. */
export function TourOffer({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <section aria-label="Tour offer" className="fade-in mb-4 flex flex-col gap-2 rounded-2xl bg-saffron-wash px-4 py-3 text-ink sm:flex-row sm:items-center">
      <p className="flex min-w-0 flex-1 items-center gap-2.5">
        <Compass className="size-5 shrink-0 text-saffron-ink" aria-hidden />
        <span>
          <span className="font-semibold">New to Salo?</span> Take a 30-second tour.
        </span>
      </p>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" onClick={onDismiss}>
          Not now
        </Button>
        <Button variant="outline" onClick={onStart}>
          Show me
        </Button>
      </div>
    </section>
  );
}
