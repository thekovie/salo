"use client";

import { useId } from "react";
import type { Kkb, KkbBlocker } from "@/lib/kkb";
import { formatPeso } from "@/lib/money";
import type { SettlementView } from "@/lib/snapshot";
import { AmountEditor } from "./amount-editor";

interface ServiceChargeBlockProps {
  kkb: Kkb;
  live: SettlementView["serviceCharge"];
  sessionId: string;
  refresh: () => Promise<unknown>;
  /** Host. */
  canEdit: boolean;
  isHost: boolean;
}

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/** Why the charge can't be split yet, in words that say what to do about it. */
export function blockerText(b: KkbBlocker, isHost: boolean): string {
  switch (b.kind) {
    case "unpriced":
      return `${items(b.units)} without a price (${b.where.join(", ")}).`;
    case "unbilled":
      return `No one is paying for ${b.dishes.join(", ")} yet. ${isHost ? "Tap each shared dish and choose who pays under Bill to." : "The host can choose who pays."}`;
    case "pending":
      return `${b.count === 1 ? "A change is" : `${b.count} changes are`} still waiting to be confirmed with the waiter.`;
    case "zeroFood":
      return "There's no priced food to split the charge across yet.";
  }
}

/**
 * The receipt's one service charge, after everyone's food. Host types it; everyone sees whether it is split yet and,
 * if not, exactly what is holding it up.
 */
export function ServiceChargeBlock({ kkb, live, sessionId, refresh, canEdit, isHost }: ServiceChargeBlockProps) {
  const id = useId();

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl bg-paper p-4" id="kkb-service">
      <h3 id={`${id}-title`} className="text-lg">
        Service charge
      </h3>

      {canEdit ? (
        <AmountEditor label="Service charge from receipt (₱)" hint="Blank = not entered yet · 0 = the receipt has none." path={`/api/sessions/${sessionId}/service-charge`} live={live} refresh={refresh} />
      ) : (
        <p className="mt-1 text-ink-soft">
          {live.centavos == null ? "Not entered yet. The host adds it from the receipt." : live.centavos === 0 ? "None on this receipt." : <span className="tally text-ink">{formatPeso(live.centavos)}</span>}
        </p>
      )}

      {kkb.charge.state === "blocked" ? (
        <div id="kkb-review" className="mt-3 rounded-xl bg-saffron-wash px-3 py-2.5 text-sm text-ink" tabIndex={-1}>
          <p className="font-semibold">Not yet allocated. To split {formatPeso(kkb.charge.centavos)} by food:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {kkb.charge.blockers.map((b) => (
              <li key={b.kind}>{blockerText(b, isHost)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
