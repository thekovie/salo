import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";
import { WaiterActions } from "@/components/waiter/waiter-actions";
import { consolidate } from "@/lib/consolidate";
import { liveTicket, snapshotText } from "@/lib/ticket";
import { loadSessionForPage } from "@/server/sessions/page-data";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Waiter ticket", robots: { index: false, follow: false } };

/** A direct link to the current ticket (the workspace opens the same view in place). Viewing never confirms. */
export default async function WaiterPage({ params }: Props) {
  const data = await loadSessionForPage((await params).id);
  if (!data) notFound();
  const { snapshot } = data;
  const round = snapshot.rounds.find((r) => r.id === snapshot.activeRoundId) ?? snapshot.rounds[0];
  const confirmed = round.status === "CONFIRMED" ? snapshot.tickets[round.id] : undefined;
  const ticket =
    confirmed ??
    liveTicket({ roundNumber: round.number, title: snapshot.session.title, ticket: consolidate(snapshot.entries.filter((e) => e.roundId === round.id)), corrections: snapshot.corrections, roundId: round.id });

  return (
    <div className="min-h-dvh bg-paper pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-3 py-2">
        <Link href={`/s/${snapshot.session.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold hover:bg-ink/6">
          <ArrowLeft className="size-5" aria-hidden /> Back to order
        </Link>
        <WaiterActions text={snapshotText(ticket)} />
      </div>
      <main className="mx-auto mt-2 max-w-3xl px-1">
        <WaiterTicket ticket={ticket} confirmed={Boolean(confirmed)} />
      </main>
      <p className="mx-auto mt-4 max-w-3xl px-6 text-center text-sm text-ink-soft">
        {confirmed ? "Confirmed with the waiter. Add-ons go in a new round." : "Showing this ticket doesn’t confirm or send anything."}
      </p>
    </div>
  );
}
