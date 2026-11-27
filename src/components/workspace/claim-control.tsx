"use client";

import { Clock, Hand } from "lucide-react";
import type { SessionSnapshot } from "@/lib/snapshot";

/** Who may be claimed from, and what I already asked about. */
export function claimSets(snapshot: Pick<SessionSnapshot, "participants" | "claims" | "me">) {
  return {
    hostIds: new Set(snapshot.participants.filter((p) => p.role === "HOST").map((p) => p.id)),
    myClaims: new Set(snapshot.claims.filter((c) => c.requestedBy === snapshot.me.participantId).map((c) => c.batchId)),
  };
}

export function ClaimControl<E>({ entry, asked, onClaim }: { entry: E; asked: boolean; onClaim: (entry: E) => void }) {
  return asked ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-sm text-ink-soft">
      <Clock className="size-4" aria-hidden /> Asked the host
    </span>
  ) : (
    <button type="button" onClick={() => onClaim(entry)} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-input px-3 text-sm font-semibold hover:bg-paper">
      <Hand className="size-4" aria-hidden /> That&rsquo;s mine
    </button>
  );
}
