"use client";

import { LoaderCircle, UserX, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";

const REASON_MAX = 140;

interface RemoveGuestSheetProps {
  name: string;
  /** Items they added themselves in the open round, which come off the ticket. */
  itemCount: number;
  roundNumber: number;
  /** Resolves true when the server accepted it. */
  onRemove: (reason: string | null) => Promise<boolean>;
}

/** Host only: remove a guest from the order, with an optional note only they will see. */
export function RemoveGuestSheet({ name, itemCount, roundNumber, onRemove }: RemoveGuestSheetProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    const accepted = await onRemove(reason.trim() || null);
    setBusy(false);
    if (!accepted) return setError(`Couldn’t remove ${name}. Check your connection and try again.`);
    setOpen(false);
    setReason("");
  }

  return (
    <Drawer open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DrawerTrigger aria-label={`Remove ${name}`} className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-soft hover:bg-bad-wash hover:text-bad">
        <UserX className="size-5" aria-hidden />
      </DrawerTrigger>
      <DrawerContent>
        <div className="flex items-start justify-between gap-3">
          <DrawerTitle className="font-display text-2xl font-medium">Remove {name} from the order?</DrawerTitle>
          <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
            <X className="size-5" aria-hidden />
          </DrawerClose>
        </div>
        <DrawerDescription className="mt-2 text-ink-soft">
          {itemCount === 1 ? `The 1 item they added in round ${roundNumber} comes off the ticket. ` : itemCount > 1 ? `The ${itemCount} items they added in round ${roundNumber} come off the ticket. ` : ""}
          They can join again with the invite.
        </DrawerDescription>
        <div className="mt-4">
          <label htmlFor={`${id}-reason`} className="text-sm font-semibold">
            Reason <span className="font-normal text-ink-soft">(optional, only {name} sees it)</span>
          </label>
          <textarea
            id={`${id}-reason`}
            value={reason}
            maxLength={REASON_MAX}
            rows={2}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Wrong table, sorry!"
            aria-describedby={`${id}-count`}
            className="mt-1 w-full resize-none rounded-xl border-[1.5px] border-input bg-ticket px-3 py-2 text-base"
          />
          <p id={`${id}-count`} className="text-right text-xs text-ink-soft tabular-nums">
            {reason.length}/{REASON_MAX}
          </p>
        </div>
        <p role="alert" className={error ? "mt-2 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad" : "sr-only"}>
          {error}
        </p>
        <div className="mt-4 grid gap-2">
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <UserX className="size-5" aria-hidden />}
            {busy ? "Removing…" : `Remove ${name}`}
          </Button>
          <DrawerClose asChild>
            <Button variant="ghost" disabled={busy}>
              Keep {name}
            </Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
