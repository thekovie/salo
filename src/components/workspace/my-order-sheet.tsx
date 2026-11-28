"use client";

import { CircleCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import type { OverlayEntry } from "@/hooks/use-session";
import type { SessionSnapshot } from "@/lib/snapshot";
import { myOrderRows, type MyOrderRow } from "@/lib/views";
import { cn } from "@/lib/utils";
import { ClaimControl, claimSets } from "./claim-control";
import { EditButton, type TicketActions } from "./order-ticket";
import { Stepper } from "./stepper";

interface MyOrderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: SessionSnapshot;
  /** The open round's entries with queued changes applied, so steppers move at once. */
  entries: OverlayEntry[];
  roundNumber: number;
  actions: TicketActions;
  iAmReady: boolean;
  onToggleReady: () => void;
  onClaim: (entry: OverlayEntry) => void;
}

interface RowContext {
  actions: TicketActions;
  hostIds: ReadonlySet<string>;
  myClaims: ReadonlySet<string>;
  onClaim: (entry: OverlayEntry) => void;
}

function Section({ title, heading, rows, claim, ...rest }: { title: string; heading?: string; claim?: boolean; rows: MyOrderRow<OverlayEntry>[] } & RowContext) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title} className="mt-4">
      <h3 className="font-sans text-xs font-semibold tracking-wide text-ink-soft uppercase">{heading ?? title}</h3>
      <ul className="mt-1 divide-y-[1.5px] divide-dashed divide-rule">
        {rows.map((row) => (
          <Row key={row.entry.id} row={row} claim={Boolean(claim)} {...rest} />
        ))}
      </ul>
    </section>
  );
}

function Row({ row: { entry, forName, addedBy }, claim, actions, hostIds, myClaims, onClaim }: { row: MyOrderRow<OverlayEntry>; claim: boolean } & RowContext) {
  const unsaved = entry.id.startsWith("pending:");
  const editable = actions.canEdit(entry) && Boolean(actions.edit);
  // Only dishes recorded for me can be claimed, never table or group dishes.
  const claimable = claim && !editable && !unsaved && hostIds.has(entry.submittedBy);
  const showEdit = editable && !unsaved && !entry.pending;
  const note = [entry.instructions, forName ? `for ${forName}` : null, addedBy ? `added by ${addedBy}` : null].filter(Boolean);
  return (
    <li className={cn("flex items-center justify-between gap-3 py-2", entry.pending && "opacity-60")}>
      <div className="min-w-0">
        <p className="leading-snug break-words">
          {editable ? null : <span className="tally mr-1.5 text-tomato-ink">{entry.quantity}×</span>}
          {entry.dishName}
          {entry.variant ? <span className="whitespace-nowrap text-ink-soft"> · {entry.variant}</span> : null}
          {showEdit && note.length === 0 ? <EditButton entry={entry} actions={actions} name={entry.dishName} /> : null}
        </p>
        {note.length > 0 ? (
          <p className="flex items-center text-sm text-ink-soft">
            <span className="min-w-0 break-words">{note.join(" · ")}</span>
            {showEdit ? <EditButton entry={entry} actions={actions} name={entry.dishName} /> : null}
          </p>
        ) : null}
        {entry.pending ? <p className="text-xs font-semibold text-saffron-ink">Saving…</p> : null}
      </div>
      {editable ? (
        <Stepper value={entry.quantity} disabled={unsaved} label={entry.dishName} onChange={(q) => actions.setQuantity(entry, q)} onRemove={() => actions.remove(entry)} />
      ) : claimable ? (
        <ClaimControl entry={entry} asked={myClaims.has(entry.batchId)} onClaim={onClaim} />
      ) : null}
    </li>
  );
}

/** A guest's review of the open round before telling the host they're done (F08): what is theirs, fix it, then ready. */
export function MyOrderSheet({ open, onOpenChange, snapshot, entries, roundNumber, actions, iAmReady, onToggleReady, onClaim }: MyOrderSheetProps) {
  const groups = myOrderRows(entries, snapshot, snapshot.me.participantId);
  const ctx: RowContext = {
    actions,
    ...claimSets(snapshot),
    onClaim,
  };
  const nothing = groups.forYou.length === 0 && groups.typedForYou.length === 0;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div data-ph-mask="">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DrawerTitle className="font-display text-2xl font-medium">My order</DrawerTitle>
              <DrawerDescription aria-live="polite" className="mt-0.5 text-sm text-ink-soft">
                Round {roundNumber} · {iAmReady ? "You’re ready" : "Not marked ready yet"}
              </DrawerDescription>
            </div>
            <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
              <X className="size-5" aria-hidden />
            </DrawerClose>
          </div>
          {nothing ? <p className="mt-4 text-ink-soft">Nothing for you in round {roundNumber} yet.</p> : null}
          <Section title="For you" claim rows={groups.forYou} {...ctx} />
          <Section title="The host added these" claim heading={`The host added these for “${snapshot.me.displayName}”. Yours?`} rows={groups.typedForYou} {...ctx} />
          <Section title="You added for others" rows={groups.byYou} {...ctx} />
          <Section title="Shared" rows={groups.shared} {...ctx} />
          <div className="sticky bottom-0 -mx-5 mt-5 bg-ticket px-5 pt-2">
            <Button variant={iAmReady ? "outline" : "primary"} aria-pressed={iAmReady} onClick={onToggleReady} className={cn("w-full", iAmReady && "border-0 bg-ok-wash text-ok")}>
              <CircleCheck className="size-5" aria-hidden />
              {iAmReady ? "Ready · tap to undo" : "I’m ready"}
            </Button>
            <p className="mt-1.5 text-pretty text-center text-sm text-ink-soft">The host sees this. Changing anything clears it.</p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
