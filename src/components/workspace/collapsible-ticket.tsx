"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ComponentProps } from "react";
import { Stamp } from "@/components/ticket/stamp";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";

/** Above this many dishes the confirmed ticket on the Order tab sits behind a disclosure. */
const COLLAPSE_ABOVE = 8;

/** The confirmed ticket on the Order tab: a long one folds to its header so Served is not 3,000 px down. */
export function CollapsibleTicket(props: ComponentProps<typeof WaiterTicket>) {
  const { ticket } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  if (ticket.dishes.length <= COLLAPSE_ABOVE)
    return <WaiterTicket {...props} />;
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="ticket flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-6 pt-2 pb-4 text-left"
      >
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="round-label text-sm">
            Round {ticket.roundNumber}
          </span>
          {open ? null : <Stamp className="text-sm" />}
          <span className="sr-only">Confirmed with the waiter</span>
        </span>
        <span className="flex items-center gap-1.5 text-sm text-ink-soft">
          <span className="tally">{ticket.totalItems}</span> items
          <ChevronDown
            className={`size-5 shrink-0 ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      <div id={id} hidden={!open}>
        {open ? <WaiterTicket {...props} /> : null}
      </div>
    </div>
  );
}
