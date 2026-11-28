import { isPlain, preparationLabel } from "./consolidate";
import { confirmedIds, effectiveEntry } from "./effective-order";
import { billFinal, reconcile, type Kkb } from "./kkb";
import { formatPeso } from "./money";
import { hasShare, paidByKey, paymentStatus } from "./payments";
import { reconcileReceipts, receiptName, type ReceiptState } from "./receipts";
import { trackerLines } from "./serving";
import { attributionLabel, everyone, type SessionSnapshot } from "./snapshot";
import { personKey } from "./adjustments";

const sign = (direction: "discount" | "charge") => (direction === "discount" ? "−" : "+");

function orders(snapshot: SessionSnapshot): string[] {
  const confirmed = confirmedIds(snapshot.rounds);
  const people = everyone(snapshot);
  const out: string[] = [];
  for (const round of snapshot.rounds.filter((r) => r.status === "CONFIRMED").sort((a, b) => a.number - b.number)) {
    const byPerson = new Map<string, Map<string, number>>();
    for (const entry of snapshot.entries.filter((e) => e.roundId === round.id)) {
      const { quantity, replacement } = effectiveEntry(entry, snapshot.corrections, confirmed);
      if (quantity <= 0) continue;
      const base = isPlain(entry) ? entry.dishName : `${entry.dishName} (${preparationLabel(entry)})`;
      const who = attributionLabel(entry, people) ?? "Not assigned";
      const dishes = byPerson.get(who) ?? new Map<string, number>();
      const label = replacement ? `${base} → ${replacement}` : base;
      dishes.set(label, (dishes.get(label) ?? 0) + quantity);
      byPerson.set(who, dishes);
    }
    if (byPerson.size === 0) continue;
    out.push(`Round ${round.number}`);
    for (const [who, dishes] of byPerson) out.push(`  ${who}: ${[...dishes].map(([label, n]) => `${label} ×${n}`).join(", ")}`);
  }
  return out;
}

function corrections(snapshot: SessionSnapshot): string[] {
  const confirmed = confirmedIds(snapshot.rounds);
  const left = new Map<string, number>();
  const lines = [...snapshot.corrections]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c) => {
      const dish = c.preparation ? `${c.dishName} (${c.preparation})` : c.dishName;
      let change: string;
      if (c.type === "REPLACE") change = `${dish} → ${c.replacement ?? "…"}`;
      else {
        const was = left.get(c.sourceEntryId ?? c.id) ?? snapshot.entries.find((e) => e.id === c.sourceEntryId)?.quantity ?? 0;
        const now = Math.max(0, was + (c.quantityDelta ?? 0));
        left.set(c.sourceEntryId ?? c.id, now);
        change = `${dish} ×${was} → ${now === 0 ? "cancelled" : `×${now}`}`;
      }
      return `  Round ${c.sourceRoundNumber}: ${change}${c.reason === "UNAVAILABLE" ? " (out of stock)" : ""}${confirmed.has(c.targetRoundId) ? "" : " (waiting for the waiter)"}`;
    });
  return lines.length > 0 ? ["Corrections", ...lines] : [];
}

function served(snapshot: SessionSnapshot): string[] {
  const tracker = trackerLines(snapshot);
  if (tracker.expected === 0) return [];
  const missing = tracker.rounds.flatMap((r) => r.lines).filter((l) => l.shown < l.expected);
  return ["Served", `  ${tracker.served} of ${tracker.expected} plates served`, ...(missing.length > 0 ? [`  Not served: ${missing.map((l) => `${l.label} ×${l.expected - l.shown}`).join(", ")}`] : [])];
}

function receipt(kkb: Kkb, snapshot: SessionSnapshot): string[] {
  const { settlement } = snapshot;
  const view = reconcileReceipts(kkb, settlement, snapshot);
  const verdict = (state: ReceiptState) => (state.state === "matches" ? "matches" : state.state === "more" || state.state === "less" ? `${formatPeso(state.differenceCentavos)} ${state.state} than Salo's total` : "not compared yet");
  const total = settlement.receiptTotal.centavos;
  const main = total == null ? "Receipt total not entered" : `Receipt total ${formatPeso(total)} · ${verdict(view ? view.cards[0].state : reconcile(kkb, total))}`;
  const extras = settlement.receipts.map((r) => `  ${receiptName(settlement.receipts, r)}: ${r.totalCentavos == null ? "total not entered" : formatPeso(r.totalCentavos)}`);
  const adjustments = kkb.adjustments.map((a) => `  ${a.cardLabel} ${a.amountCentavos == null ? "(waiting for prices)" : `${sign(a.direction)}${formatPeso(a.amountCentavos)}`}`);
  return ["Receipt", `  ${main}`, ...extras, ...adjustments];
}

function payments(kkb: Kkb, snapshot: SessionSnapshot): string[] {
  const { payments: all } = snapshot.settlement;
  if (all.length === 0) return ["Payments", "  None recorded"];
  const paid = paidByKey(all);
  const final = billFinal(kkb);
  const cards = kkb.sections.filter(hasShare).map((s) => {
    const status = paymentStatus(s, paid.get(s.key) ?? 0, final);
    const rest = status.chip === null ? (s.status === "none" ? "no price yet" : "nothing to pay") : status.chip === "paid" ? "paid" : status.left > 0 ? `${formatPeso(status.left)} left` : "paid so far";
    return `  ${s.title} paid ${formatPeso(status.paid)} · ${rest}`;
  });
  const names = new Map(kkb.sections.map((s) => [s.key, s.title]));
  const review = all.filter((p) => p.needsReview).map((p) => `  ${names.get(personKey(p.payer)) ?? p.payer.label ?? "Someone"} ${formatPeso(p.amountCentavos)} needs fixing`);
  return ["Payments", ...cards, ...review];
}

/** The opt-in "full record" appended to the KKB text: what was ordered, changed, served, checked and paid. Built from the same snapshot. */
export function recordText(kkb: Kkb, snapshot: SessionSnapshot): string {
  const o = orders(snapshot);
  return [o.length > 0 ? ["Orders", ...o] : [], corrections(snapshot), served(snapshot), receipt(kkb, snapshot), payments(kkb, snapshot)]
    .filter((s) => s.length > 0)
    .map((s) => s.join("\n"))
    .join("\n\n");
}
