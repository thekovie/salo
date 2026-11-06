"use client";

import { LoaderCircle, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";

interface OrderOptionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string | null;
  /** True once any round was confirmed with the waiter: then it is "End order", before that "Cancel order". */
  anyConfirmed: boolean;
  /** An open round with dishes that never reached the waiter (only matters when ending). */
  unsentRound: number | null;
  onRename: (title: string | null) => void;
  /** Resolves true when the server accepted it. */
  onEnd: () => Promise<boolean>;
}

/**
 * Host-only order settings in a bottom drawer: the name gets a full-width field (no cramped inline edit in the band),
 * and the one destructive action sits behind a second, in-drawer step instead of a nested dialog.
 */
export function OrderOptionsSheet(props: OrderOptionsSheetProps) {
  const { open, onOpenChange } = props;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/* Remounted on every open: the field starts from the current name and the confirm step resets. */}
      <DrawerContent>{open ? <OptionsBody {...props} /> : null}</DrawerContent>
    </Drawer>
  );
}

function OptionsBody({ onOpenChange, title, anyConfirmed, unsentRound, onRename, onEnd }: OrderOptionsSheetProps) {
  const id = useId();
  const [draft, setDraft] = useState(title ?? "");
  const [step, setStep] = useState<"options" | "confirm">("options");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verb = anyConfirmed ? "End" : "Cancel";

  function save(event: React.FormEvent) {
    event.preventDefault();
    const next = draft.trim() || null;
    if (next !== title) onRename(next);
    onOpenChange(false);
  }

  async function end() {
    setBusy(true);
    setError("");
    const accepted = await onEnd();
    setBusy(false);
    if (accepted) onOpenChange(false);
    else setError(`Couldn’t ${verb.toLowerCase()} the order. Check your connection and try again.`);
  }

  const close = (
    <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
      <X className="size-5" aria-hidden />
    </DrawerClose>
  );

  if (step === "confirm") {
    return (
      <div aria-busy={busy}>
        <div className="flex items-start justify-between gap-3">
          <DrawerTitle className="font-display text-2xl font-medium">{verb} this order?</DrawerTitle>
          {close}
        </div>
        <DrawerDescription asChild>
          <div className="mt-2 space-y-2 text-ink-soft">
            <p>Nobody can add or change anything after this, and the invite stops working.</p>
            {anyConfirmed ? (
              <p>Everyone can still look at the tickets for 7 days. Then the order is deleted.</p>
            ) : (
              <p>Nothing was sent to the waiter. Everyone sees it was cancelled, and it’s deleted tomorrow.</p>
            )}
            {anyConfirmed && unsentRound ? <p className="font-semibold text-ink">Round {unsentRound} was never confirmed with the waiter.</p> : null}
          </div>
        </DrawerDescription>
        <p role="alert" className={error ? "mt-3 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad" : "sr-only"}>
          {error}
        </p>
        <div className="mt-5 grid gap-2">
          <Button variant="danger" disabled={busy} onClick={() => void end()}>
            {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
            {busy ? "Working…" : `Yes, ${verb.toLowerCase()} the order`}
          </Button>
          {/* Focus lands on the safe choice when the step swaps in. */}
          <Button variant="ghost" disabled={busy} autoFocus onClick={() => setStep("options")}>
            Keep the order
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <DrawerTitle className="font-display text-2xl font-medium">Order options</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-ink-soft">Only you, the host, can change these.</DrawerDescription>
        </div>
        {close}
      </div>

      <form onSubmit={save} className="mt-4">
        <label htmlFor={`${id}-name`} className="text-sm font-semibold">
          Order name
        </label>
        <input
          id={`${id}-name`}
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Restaurant or occasion"
          enterKeyHint="done"
          aria-describedby={`${id}-name-help`}
          className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 font-display text-lg"
        />
        <p id={`${id}-name-help`} className="mt-1.5 text-sm text-ink-soft">
          Shown on the invite and in link previews.
        </p>
        <Button type="submit" className="mt-3 w-full">
          Save name
        </Button>
      </form>

      <div className="mt-6 border-t-[1.5px] border-dashed border-rule pt-5">
        <p className="font-semibold">{anyConfirmed ? "All done?" : "Not ordering after all?"}</p>
        <p className="mt-0.5 text-sm text-ink-soft">
          {anyConfirmed ? "End the order when the table is finished. Everyone can still read the tickets for a week." : "Cancel the order. Nothing has been sent to the waiter yet."}
        </p>
        <Button variant="danger" className="mt-3 w-full" onClick={() => setStep("confirm")}>
          {verb} order
        </Button>
      </div>
    </div>
  );
}
