import type { TicketSnapshot } from "@/lib/ticket";
import { cn } from "@/lib/utils";
import { Stamp } from "./stamp";

export const copyClass = (roundNumber: number) => (roundNumber >= 3 ? "ticket-copy-3" : roundNumber === 2 ? "ticket-copy-2" : "");

interface WaiterTicketProps {
  ticket: Pick<TicketSnapshot, "roundNumber" | "title" | "dishes" | "corrections" | "totalItems">;
  confirmed?: boolean;
  /** Play the stamp landing (only right after confirming). */
  justConfirmed?: boolean;
  size?: "waiter" | "compact";
  className?: string;
  /** Host, open round: each correction line gets a Remove control (ids in the same order as ticket.corrections). */
  removableCorrections?: { id: string; onRemove: () => void }[];
}

/**
 * The ticket the waiter sees (brief 5.13): big counts, preparations indented, corrections apart from new dishes,
 * the total. Each round prints on its own carbon-copy colour; a confirmed round carries the rubber stamp.
 */
export function WaiterTicket({ ticket, confirmed, justConfirmed, size = "waiter", className, removableCorrections }: WaiterTicketProps) {
  const big = size === "waiter";
  return (
    <section data-ph-mask="" aria-label={`Round ${ticket.roundNumber}${confirmed ? ", confirmed with the waiter" : ""}`} className={cn("ticket px-6", big && "sm:px-10", copyClass(ticket.roundNumber), justConfirmed && "thunk", className)}>
      <div className="flex items-baseline justify-between gap-4 pt-2">
        <h2 className={cn("font-mono font-medium tracking-[0.16em] text-tomato-ink uppercase", big ? "text-lg" : "text-sm")}>Round {ticket.roundNumber}</h2>
        {confirmed ? (
          // The stamp sits in the header row's empty space: it shows the word without covering any dish or count.
          <Stamp animate={justConfirmed} className={cn("-my-2 mr-1", big ? "text-xl" : "text-sm")} />
        ) : ticket.title && big ? (
          <p className="truncate text-ink-soft">{ticket.title}</p>
        ) : null}
      </div>
      {ticket.dishes.length === 0 && ticket.corrections.length === 0 ? (
        <p className="py-12 text-center text-xl text-ink-soft">Nothing to order yet.</p>
      ) : (
        <ul className={cn("divide-dashed divide-rule", big ? "mt-4 divide-y-2" : "mt-2 divide-y-[1.5px]")}>
          {ticket.dishes.map((dish) => (
            <li key={dish.name} className={big ? "py-4" : "py-2"}>
              <div className="flex items-baseline justify-between gap-4">
                <span className={big ? "text-[clamp(1.6rem,6vw,2.6rem)] leading-tight font-semibold" : "text-lg"}>{dish.name}</span>
                <span className={cn("tally shrink-0 leading-none text-tomato-ink", big ? "text-[clamp(2.4rem,10vw,4.2rem)]" : "text-2xl")}>×{dish.quantity}</span>
              </div>
              {dish.lines.length ? (
                <ul className={cn("mt-1 space-y-0.5 border-l-[1.5px] border-rule pl-4", big ? "text-[clamp(1.25rem,4.5vw,1.9rem)]" : "text-ink-soft")}>
                  {dish.lines.map((line) => (
                    <li key={line.label} className="flex items-baseline justify-between gap-4">
                      <span>{line.label}</span>
                      <span className="tally">×{line.quantity}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {ticket.corrections.length ? (
        <div className={cn("tear mt-2 pt-3", big ? "pb-1" : "")}>
          <h3 className={cn("font-mono tracking-[0.14em] text-tomato-ink uppercase", big ? "text-base" : "text-xs")}>Corrections</h3>
          <ul className={cn("mt-1 space-y-1", big ? "text-[clamp(1.15rem,4vw,1.6rem)]" : "text-sm")}>
            {ticket.corrections.map((c, i) => {
              const removable = removableCorrections?.[i];
              return (
                <li key={removable?.id ?? c} className={removable ? "flex items-center justify-between gap-2" : undefined}>
                  <span>{c}</span>
                  {removable ? (
                    <button type="button" onClick={removable.onRemove} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full px-3 text-sm font-semibold text-ink-soft hover:bg-ink/6 hover:text-ink">
                      Remove<span className="sr-only">: {c}</span>
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="tear mt-2 flex items-baseline justify-between pt-4 pb-2">
        <span className={cn("text-ink-soft", big && "text-xl")}>Total</span>
        <span className={cn("tally", big ? "text-[clamp(1.8rem,7vw,3rem)]" : "text-lg")}>
          {ticket.totalItems} {ticket.totalItems === 1 ? "item" : "items"}
        </span>
      </div>
    </section>
  );
}
