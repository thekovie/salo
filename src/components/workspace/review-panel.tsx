"use client";

import { ArrowLeft, CircleAlert, CircleCheck, Clock, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";
import type { TicketSnapshot } from "@/lib/ticket";
import type { SessionSnapshot, SnapshotEntry } from "@/lib/snapshot";
import { findLikelyDuplicates, readinessSummary } from "@/lib/views";
import { ConfirmDialog } from "./confirm-dialog";
import { FullScreenSheet } from "./full-screen-sheet";

interface ReviewPanelProps {
  snapshot: SessionSnapshot;
  entries: SnapshotEntry[];
  ticket: TicketSnapshot;
  roundId: string;
  unsaved: number;
  notSaved: number;
  onBack: () => void;
  onShowWaiter: () => void;
  onConfirm: () => Promise<string | null>;
  onRemoveDuplicate: (entry: SnapshotEntry) => void;
}

function Check({ ok, children }: { ok: boolean | "wait"; children: React.ReactNode }) {
  const Icon = ok === true ? CircleCheck : ok === "wait" ? Clock : CircleAlert;
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={ok === true ? "mt-0.5 size-5 shrink-0 text-ok" : "mt-0.5 size-5 shrink-0 text-saffron-ink"} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

/** Review before telling the waiter (brief 5.12): what is ordered, and anything that might be wrong. */
export function roundSummary(ticket: Pick<TicketSnapshot, "totalItems" | "corrections">): string {
  const items = `${ticket.totalItems} ${ticket.totalItems === 1 ? "item" : "items"}`;
  const fixes = ticket.corrections.length ? `${ticket.corrections.length} ${ticket.corrections.length === 1 ? "correction" : "corrections"}` : "";
  return ticket.totalItems === 0 && fixes ? fixes : [items, fixes].filter(Boolean).join(", ");
}

export function ReviewPanel({ snapshot, entries, ticket, unsaved, notSaved, onBack, onShowWaiter, onConfirm, onRemoveDuplicate }: ReviewPanelProps) {
  const isHost = snapshot.me.role === "HOST";
  const ready = readinessSummary(snapshot);
  const choosing = snapshot.participants.filter((p) => p.role === "GUEST" && !ready.readyIds.has(p.id));
  const hints = isHost ? findLikelyDuplicates(entries, snapshot.participants) : [];
  const empty = ticket.totalItems === 0 && ticket.corrections.length === 0;
  const blocked = unsaved > 0 || notSaved > 0 || empty;

  return (
    <FullScreenSheet label={`Review round ${ticket.roundNumber}`} onClose={onBack} className="pb-[calc(env(safe-area-inset-bottom)+8rem)]">
      <div className="sticky top-0 z-10 bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
        <div className="mx-auto max-w-2xl px-3 pt-2 pb-1">
          <Button variant="ghost" onClick={onBack} className="-ml-2">
            <ArrowLeft className="size-5" aria-hidden /> Back to order
          </Button>
          <h2 className="mt-1 px-1 text-2xl">Review round {ticket.roundNumber}</h2>
        </div>
      </div>
      <div className="mx-auto max-w-2xl space-y-4 px-3 pt-2">
        <ul className="ticket space-y-3 px-5" aria-label="Checks">
          <Check ok={unsaved === 0 && notSaved === 0 ? true : unsaved > 0 ? "wait" : false}>
            {notSaved > 0 ? `${notSaved} ${notSaved === 1 ? "change was" : "changes were"} not saved. Go back to see which.` : unsaved > 0 ? `${unsaved} ${unsaved === 1 ? "change is" : "changes are"} still saving…` : "Everything is saved."}
          </Check>
          {ready.total > 0 ? (
            <Check ok={choosing.length === 0 ? true : "wait"}>
              {ready.ready} of {ready.total} {ready.total === 1 ? "guest" : "guests"} ready
              {choosing.length ? <span className="text-ink-soft"> · still choosing: {choosing.map((p) => p.displayName).join(", ")}</span> : null}
            </Check>
          ) : null}
          {isHost ? (
            <Check ok={hints.length === 0}>
              {hints.length === 0 ? (
                "No dishes look ordered twice."
              ) : (
                <>
                  <p>Possibly ordered twice:</p>
                  <ul className="mt-1 space-y-1">
                    {hints.map((h) => (
                      <li key={`${h.hostEntry.id}:${h.participantId}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          {h.personName}: {h.dishName} (theirs ×{h.ownEntry.quantity}, yours for them ×{h.hostEntry.quantity})
                        </span>
                        <button type="button" onClick={() => onRemoveDuplicate(h.hostEntry)} className="min-h-11 cursor-pointer rounded-full px-3 font-semibold ring-[1.5px] ring-input hover:bg-paper">
                          Remove your copy
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Check>
          ) : null}
        </ul>

        <WaiterTicket ticket={ticket} size="compact" />
      </div>

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-paper from-70% to-transparent pt-6 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 px-3 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" onClick={onShowWaiter} disabled={empty}>
            <ReceiptText className="size-5" aria-hidden /> Show the waiter
          </Button>
          {isHost ? (
            <ConfirmDialog
              title={`Confirm round ${ticket.roundNumber} with the waiter?`}
              body={
                <>
                  <p>This saves round {ticket.roundNumber} exactly as shown ({roundSummary(ticket)}).</p>
                  <p>Its dishes can&rsquo;t be changed afterwards. Anything else goes in a new round, as add-ons or corrections.</p>
                </>
              }
              confirmLabel="Yes, the waiter has it"
              busyLabel="Confirming…"
              onConfirm={onConfirm}
              trigger={(open) => (
                <Button size="lg" onClick={open} disabled={blocked}>
                  <CircleCheck className="size-5" aria-hidden /> Mark confirmed with waiter
                </Button>
              )}
            />
          ) : null}
        </div>
        {isHost && blocked && !empty ? <p className="mx-auto mt-1 max-w-2xl px-4 text-center text-sm text-ink-soft">Confirm once every change is saved.</p> : null}
      </div>
    </FullScreenSheet>
  );
}
