"use client";

import { ArrowLeft, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";
import { WaiterActions } from "@/components/waiter/waiter-actions";
import { snapshotText, type TicketSnapshot } from "@/lib/ticket";
import { ConfirmDialog } from "./confirm-dialog";

interface WaiterPanelProps {
  ticket: TicketSnapshot;
  confirmed: boolean;
  justConfirmed: boolean;
  canConfirm: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

/** Full-screen ticket to read out or hand over (brief 5.13). Showing it never confirms anything. */
export function WaiterPanel({ ticket, confirmed, justConfirmed, canConfirm, onBack, onConfirm }: WaiterPanelProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+7rem)]" role="region" aria-label="Waiter ticket">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-3 py-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-5" aria-hidden /> Back
        </Button>
        <WaiterActions text={snapshotText(ticket)} />
      </div>
      <main className="mx-auto mt-2 max-w-3xl px-1">
        <WaiterTicket ticket={ticket} confirmed={confirmed} justConfirmed={justConfirmed} />
        <p className="mt-4 px-6 text-center text-sm text-ink-soft">
          {confirmed ? "Confirmed. Add-ons go in a new round. Kain na!" : "Showing this ticket doesn’t confirm or send anything."}
        </p>
      </main>
      {canConfirm && !confirmed ? (
        <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-paper from-70% to-transparent pt-6 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <div className="mx-auto max-w-3xl px-3">
            <ConfirmDialog
              title={`Confirm round ${ticket.roundNumber} with the waiter?`}
              body={
                <>
                  <p>This saves round {ticket.roundNumber} exactly as shown ({ticket.totalItems} items).</p>
                  <p>Its dishes can&rsquo;t be changed afterwards. Anything else goes in a new round, as add-ons or corrections.</p>
                </>
              }
              confirmLabel="Yes, the waiter has it"
              onConfirm={onConfirm}
              trigger={(open) => (
                <Button size="lg" className="w-full" onClick={open}>
                  <CircleCheck className="size-5" aria-hidden /> Confirmed with waiter
                </Button>
              )}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
