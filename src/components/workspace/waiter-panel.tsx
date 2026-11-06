"use client";

import { ArrowLeft, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WaiterTicket } from "@/components/ticket/waiter-ticket";
import { WaiterActions } from "@/components/waiter/waiter-actions";
import { snapshotText, type TicketSnapshot } from "@/lib/ticket";
import { ConfirmDialog } from "./confirm-dialog";
import { FullScreenSheet } from "./full-screen-sheet";
import { roundSummary } from "./review-panel";

interface WaiterPanelProps {
  ticket: TicketSnapshot;
  confirmed: boolean;
  justConfirmed: boolean;
  canConfirm: boolean;
  onBack: () => void;
  onConfirm: () => Promise<string | null>;
}

/** Full-screen ticket to read out or hand over (brief 5.13). Showing it never confirms anything. */
export function WaiterPanel({ ticket, confirmed, justConfirmed, canConfirm, onBack, onConfirm }: WaiterPanelProps) {
  return (
    <FullScreenSheet label="Waiter ticket" onClose={onBack} className="pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-3 py-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-5" aria-hidden /> Back
        </Button>
        <WaiterActions text={snapshotText(ticket)} />
      </div>
      <div className="mx-auto mt-2 max-w-3xl px-1">
        <WaiterTicket ticket={ticket} confirmed={confirmed} justConfirmed={justConfirmed} />
        {canConfirm && !confirmed ? (
          // The host's action sits under the ticket, quietly: the screen belongs to the waiter reading it.
          <div className="mt-5 px-5">
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
                <Button variant="outline" size="lg" className="w-full" onClick={open}>
                  <CircleCheck className="size-5" aria-hidden /> Mark confirmed with waiter
                </Button>
              )}
            />
          </div>
        ) : null}
        <p className="mt-4 px-6 text-center text-sm text-ink-soft">
          {confirmed ? "Confirmed. Add-ons go in a new round. Kain na!" : "Showing this ticket doesn’t confirm or send anything."}
        </p>
      </div>
    </FullScreenSheet>
  );
}
