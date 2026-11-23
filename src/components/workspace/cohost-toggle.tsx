"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface CohostToggleProps {
  name: string;
  isCohost: boolean;
  /** Resolves true when the server accepted it. */
  onSet: (cohost: boolean) => Promise<boolean>;
}

/** Host only: let a guest help mark food as served, or take that back. */
export function CohostToggle({ name, isCohost, onSet }: CohostToggleProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    const accepted = await onSet(!isCohost);
    setBusy(false);
    if (!accepted) setError("Couldn’t save. Check your connection and try again.");
  }

  return (
    <div className="mb-2">
      <Button type="button" variant="outline" onClick={toggle} disabled={busy} className="ph-no-capture min-w-36">
        {busy ? "Saving…" : isCohost ? "Stop co-host" : "Make co-host"}
        <span className="sr-only"> for {name}</span>
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
