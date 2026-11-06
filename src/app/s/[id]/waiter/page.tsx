import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WaiterActions } from "@/components/waiter/waiter-actions";
import { consolidate, hasSubLines, preparationLabel, ticketText } from "@/lib/consolidate";
import { cn } from "@/lib/utils";
import { loadSessionForPage } from "@/server/sessions/page-data";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Waiter ticket", robots: { index: false, follow: false } };

/**
 * What the waiter needs and nothing else (brief 5.13): big counts, variants indented, the total. Built to be read
 * aloud by the host or handed over. Viewing it never confirms anything.
 */
export default async function WaiterPage({ params }: Props) {
  const data = await loadSessionForPage((await params).id);
  if (!data) notFound();
  const { snapshot } = data;
  const round = snapshot.rounds.find((r) => r.id === snapshot.activeRoundId) ?? snapshot.rounds[0];
  const ticket = consolidate(snapshot.entries.filter((e) => e.roundId === round.id));
  const heading = `Round ${round.number}`;

  return (
    <div className="min-h-dvh bg-paper pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-3 py-2">
        <Link href={`/s/${snapshot.session.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold hover:bg-ink/6">
          <ArrowLeft className="size-5" aria-hidden /> Back to order
        </Link>
        <WaiterActions text={ticketText(`${snapshot.session.title ? `${snapshot.session.title} · ` : ""}${heading}`, ticket)} />
      </div>

      <main className={cn("ticket mx-auto mt-2 max-w-3xl px-6 sm:px-10", round.number === 2 && "ticket-copy-2", round.number >= 3 && "ticket-copy-3")}>
        <div className="flex items-baseline justify-between gap-4 pt-2">
          <h1 className="font-mono text-lg font-medium tracking-[0.16em] text-tomato-ink uppercase">{heading}</h1>
          {snapshot.session.title ? <p className="truncate text-ink-soft">{snapshot.session.title}</p> : null}
        </div>

        {ticket.dishes.length === 0 ? (
          <p className="py-16 text-center text-xl text-ink-soft">Nothing to order yet.</p>
        ) : (
          <ul className="mt-4 divide-y-2 divide-dashed divide-rule">
            {ticket.dishes.map((dish) => (
              <li key={dish.dishId} className="py-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[clamp(1.6rem,6vw,2.6rem)] leading-tight font-semibold">{dish.name}</span>
                  <span className="tally shrink-0 text-[clamp(2.4rem,10vw,4.2rem)] leading-none text-tomato-ink">×{dish.quantity}</span>
                </div>
                {hasSubLines(dish) ? (
                  <ul className="mt-2 space-y-1 border-l-[1.5px] border-rule pl-4">
                    {dish.preparations.map((line) => (
                      <li key={line.key} className="flex items-baseline justify-between gap-4 text-[clamp(1.25rem,4.5vw,1.9rem)]">
                        <span>{preparationLabel(line)}</span>
                        <span className="tally text-ink">×{line.quantity}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="tear mt-2 flex items-baseline justify-between pt-4 pb-2">
          <span className="text-xl text-ink-soft">Total</span>
          <span className="tally text-[clamp(1.8rem,7vw,3rem)]">
            {ticket.totalItems} {ticket.totalItems === 1 ? "item" : "items"}
          </span>
        </div>
      </main>
      <p className="mx-auto mt-4 max-w-3xl px-6 text-center text-sm text-ink-soft">Showing this ticket doesn’t confirm or send anything.</p>
    </div>
  );
}
