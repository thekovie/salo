"use client";

import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useDirectSave, useRetryOnReconnect } from "@/hooks/use-direct-save";
import { cn } from "@/lib/utils";

export interface HandoverGuest {
  id: string;
  displayName: string;
  cohost: boolean;
}

interface HostHandoverProps {
  sessionId: string;
  guests: readonly HandoverGuest[];
  /** The host is still called "Host": the new host's phone would show that to everyone, so a name is asked for. */
  needsName: boolean;
  /** Runs after a successful hand over, before the snapshot refresh flips this device to a guest. */
  refresh: () => Promise<unknown>;
  onBack: () => void;
  /** The drawer's close button. */
  close: React.ReactNode;
  onDone: () => void;
}

/** Hand over host in two steps, pick then confirm (F09). Goes straight to the server and waits: it must happen while the host is looking. */
export function HostHandover({ sessionId, guests, needsName, refresh, onBack, close, onDone }: HostHandoverProps) {
  const id = useId();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "handover">("pick");
  const [name, setName] = useState("");
  const { state, save } = useDirectSave(refresh);
  const picked = guests.find((g) => g.id === pickedId);
  const busy = state.kind === "saving";
  const nameMissing = needsName && name.trim() === "";

  async function hand() {
    if (!picked || nameMissing) return;
    const ok = await save(`/api/sessions/${sessionId}/host`, "PUT", { participantId: picked.id, ...(needsName ? { displayName: name.trim() } : {}) });
    if (ok) onDone();
  }
  useRetryOnReconnect(step === "handover" && state.kind === "error" && state.retryable, () => void hand());

  if (step === "pick" || !picked) {
    return (
      <div>
        <div className="flex items-start justify-between gap-3">
          <Button variant="ghost" onClick={onBack} className="-ml-3">
            <ArrowLeft className="size-5" aria-hidden /> Hand over host
          </Button>
          {close}
        </div>
        <DrawerTitle className="font-display text-2xl font-medium">Who should host this order?</DrawerTitle>
        <DrawerDescription className="sr-only">Pick one person who has joined the order.</DrawerDescription>
        <fieldset className="mt-3">
          <legend className="sr-only">Who should host this order?</legend>
          <div className="space-y-1">
            {guests.map((g) => (
              <label key={g.id} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-ink/6", pickedId === g.id && "bg-paper")}>
                <input type="radio" name={`${id}-host`} checked={pickedId === g.id} onChange={() => setPickedId(g.id)} className="size-5 shrink-0 accent-tomato" />
                <span className="min-w-0 break-words">
                  {g.displayName}
                  {g.cohost ? <span className="text-ink-soft"> · co-host</span> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button className="mt-4 w-full" disabled={!picked} onClick={() => setStep("handover")}>
          Continue
        </Button>
      </div>
    );
  }

  const failure = state.kind === "error" ? (state.retryable ? "No connection. Keep this open: it hands over as soon as you’re back online." : state.message) : "";
  return (
    <div aria-busy={busy}>
      <div className="flex items-start justify-between gap-3">
        <Button variant="ghost" disabled={busy} onClick={() => setStep("pick")} className="-ml-3">
          <ArrowLeft className="size-5" aria-hidden /> Back
        </Button>
        {close}
      </div>
      <DrawerTitle className="font-display text-2xl font-medium">Make {picked.displayName} the host?</DrawerTitle>
      <DrawerDescription asChild>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-ink-soft">
          <li>{picked.displayName} can confirm rounds, change prices, record payments and end the order.</li>
          <li>You become a guest. You can’t undo this; only {picked.displayName} can hand it back.</li>
          <li>Everyone’s phone updates right away.</li>
        </ul>
      </DrawerDescription>
      {needsName ? (
        <div className="mt-4">
          <label htmlFor={`${id}-name`} className="text-sm font-semibold">
            Your name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={40}
            required
            onChange={(e) => setName(e.target.value)}
            placeholder="Shown on your dishes"
            autoComplete="given-name"
            className="mt-1 min-h-12 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base"
          />
        </div>
      ) : null}
      <p role="alert" className={failure ? "mt-3 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad" : "sr-only"}>
        {failure}
      </p>
      <div className="mt-5 grid gap-2">
        <Button disabled={busy || nameMissing} onClick={() => void hand()}>
          {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
          {busy ? "Working…" : `Make ${picked.displayName} the host`}
        </Button>
        <Button variant="ghost" disabled={busy} autoFocus onClick={onDone}>
          Keep hosting
        </Button>
      </div>
    </div>
  );
}
