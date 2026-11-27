"use client";

import { Check, Circle, CircleAlert, CircleCheck, Contrast, Copy, Pencil, Share2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { personKey } from "@/lib/adjustments";
import { normalizeText } from "@/lib/dish-name";
import { track } from "@/lib/analytics";
import { buildKkb, kkbText, priceCompleteness, tableLines, type Kkb, type KkbLine, type KkbSection } from "@/lib/kkb";
import { formatPeso } from "@/lib/money";
import { billFinal, hasShare, paidByKey, paymentStatus, paymentTotals, type PaymentStatus } from "@/lib/payments";
import type { SessionSnapshot } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { HostNamePrompt } from "./host-name-prompt";
import { PricesSheet } from "./prices-sheet";
import { PriceEditor, type Payer, type TablePrice } from "./price-editor";
import { AdjustmentsBlock } from "./adjustments-block";
import { FixPaymentSheet } from "./fix-payment-sheet";
import { PaymentSheet } from "./payment-sheet";
import { CardPaymentRows, PaymentsBlock } from "./payments-block";
import { ReceiptCheckBlock } from "./receipt-check-block";
import { ServiceChargeBlock } from "./service-charge-block";

interface KkbViewProps {
  snapshot: SessionSnapshot;
  refresh: () => Promise<unknown>;
  onRenameMe: (displayName: string) => void;
  dateLabel: string;
  canShare: boolean;
}

/** The viewer's own card: "My share" in the dock lands here. */
export const MY_CARD_ID = "kkb-mine";

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;
const lineKey = (section: KkbSection, line: KkbLine, draft: boolean) => `${section.key}|${line.entryId}|${line.correctionId ?? ""}|${draft ? "d" : "c"}`;

/**
 * KKB inside "Who ordered what": each person's food from confirmed rounds, then shared dishes, then the receipt's
 * service charge split by food once nothing is missing. The viewer's own card comes first; the host can price
 * anything, guests the dishes they added.
 */
export function KkbView({ snapshot, refresh, onRenameMe, dateLabel, canShare }: KkbViewProps) {
  const meId = snapshot.me.participantId;
  const isHost = snapshot.me.role === "HOST";
  const isOpen = snapshot.session.status === "OPEN";
  const kkb = useMemo(() => buildKkb(snapshot, meId), [snapshot, meId]);
  const [editing, setEditing] = useState<string | null>(null);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "error">("idle");
  // Which cards start open is decided once, so a card doesn't snap shut while the host is pricing it.
  const [startOpen] = useState(() => new Set(kkb.sections.filter((s) => s.shared || (isHost && (s.unpricedUnits > 0 || s.drafts.some((l) => l.unitCentavos == null)))).map((s) => s.key)));
  const payers: Payer[] = useMemo(
    () => [
      ...snapshot.participants.map((p) => ({ key: `p:${p.id}`, title: p.id === meId ? `${p.displayName} (you)` : p.displayName, participantId: p.id, label: null })),
      ...kkb.sections.filter((s) => s.kind === "name").map((s) => ({ key: `n:${normalizeText(s.title)}`, title: s.title, participantId: null, label: s.title })),
    ],
    [snapshot.participants, kkb.sections, meId],
  );

  if (kkb.sections.length === 0) {
    return <p className="mt-6 rounded-2xl bg-paper px-4 py-6 text-center text-ink-soft">Nothing ordered yet. Prices show up here once there are dishes.</p>;
  }

  const allLines = tableLines(snapshot);
  /** The table price a line could set: its dish + size, and how many lines would follow it (replacements never do). */
  const tableFor = (line: KkbLine): TablePrice | null => {
    const entry = snapshot.entries.find((e) => e.id === line.entryId);
    if (!entry || line.correctionId || !line.tableKey) return null;
    const size = normalizeText(entry.variant ?? "");
    const followers = allLines.filter(({ entry: e }) => e.dishId === entry.dishId && normalizeText(e.variant ?? "") === size && (e.id === entry.id || snapshot.settlement.entries[e.id]?.unitCentavos == null));
    const live = snapshot.settlement.defaults[line.tableKey];
    return { dishId: entry.dishId, variant: entry.variant, label: entry.variant ? `${entry.dishName} (${entry.variant})` : entry.dishName, lines: followers.length, live: { unitCentavos: live?.unitCentavos ?? null, revision: live?.revision ?? 0 } };
  };

  const lineProps = (section: KkbSection, line: KkbLine, draft: boolean): LineProps => {
    const key = lineKey(section, line, draft);
    const entry = snapshot.settlement.entries[line.entryId] ?? { unitCentavos: null, billTo: null, revision: 0 };
    const live = line.correctionId ? { unitCentavos: snapshot.settlement.corrections[line.correctionId]?.unitCentavos ?? null, revision: snapshot.settlement.corrections[line.correctionId]?.revision ?? 0 } : entry;
    const leftPayers: Payer[] = (entry.splitAmong ?? []).flatMap((p) => {
      const k = personKey(p);
      return payers.some((x) => x.key === k) ? [] : [{ key: k, title: kkb.sections.find((s) => s.key === k)?.title ?? p.label ?? "Someone", participantId: p.participantId, label: p.label }];
    });
    const canPrice = line.correctionId ? isHost : isHost || (isOpen && line.submittedBy === meId);
    const table = isHost && canPrice ? tableFor(line) : null;
    const canBillTo = isHost && line.billable && !draft;
    return {
      rowKey: key,
      line,
      editing: editing === key,
      canEdit: canPrice || canBillTo,
      onEdit: () => setEditing(key),
      editor: <PriceEditor key={key} line={line} sessionId={snapshot.session.id} refresh={refresh} canPrice={canPrice} canBillTo={canBillTo} payers={payers} table={table} live={live} bill={entry} leftPayers={leftPayers} onDone={() => setEditing((open) => (open === key ? null : open))} />,
    };
  };

  const { payments } = snapshot.settlement;
  const final = billFinal(kkb);
  const paid = paidByKey(payments);
  const statusOf = (s: KkbSection) => (s.shared ? null : paymentStatus(s, paid.get(s.key) ?? 0, final));
  const payOf = (s: KkbSection): PayProps => ({
    status: statusOf(s),
    chip: payments.length > 0 && hasShare(s),
    rows: (
      <CardPaymentRows
        status={statusOf(s)}
        payments={payments.filter((p) => personKey(p.payer) === s.key)}
        snapshot={snapshot}
        isHost={isHost}
        refresh={refresh}
        onRecord={isHost && hasShare(s) ? () => setPaying(s.key) : null}
        onFix={isHost ? setFixing : null}
        showBalance={payments.length > 0 && hasShare(s)}
      />
    ),
  });
  const payingSection = kkb.sections.find((s) => s.key === paying) ?? null;

  const mine = kkb.sections.find((s) => s.isMe);
  const people = kkb.sections.filter((s) => !s.isMe && !s.shared);
  const shared = kkb.sections.filter((s) => s.shared);
  const title = snapshot.session.title ?? "Table order";
  const text = kkbText(kkb, title, dateLabel);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
      setTimeout(() => setCopy("idle"), 2500);
      track({ name: "summary_copied", props: { tab: "kkb" } });
    } catch {
      setCopy("error");
    }
  }

  async function shareSummary() {
    try {
      await navigator.share({ title: `${title}: KKB`, text });
    } catch {
      // Cancelled: nothing to say.
    }
  }

  const draftRound = snapshot.rounds.find((r) => r.status === "DRAFT")?.number ?? null;
  const needsName = isHost && isOpen && snapshot.me.displayName.trim().toLowerCase() === "host";

  return (
    <div className="mt-4 space-y-4" data-ph-mask="">
      <StatusStrip kkb={kkb} onEnterPrices={isHost ? () => setPricesOpen(true) : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void copySummary()}>
          {copy === "copied" ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
          Copy summary
        </Button>
        {canShare ? (
          <Button variant="outline" onClick={() => void shareSummary()}>
            <Share2 className="size-5" aria-hidden />
            Share summary
          </Button>
        ) : null}
        <p role="status" className={cn("text-sm", copy === "error" ? "text-bad" : "text-ok")}>
          {copy === "copied" ? "Summary copied" : copy === "error" ? "Couldn’t copy. Try Share, or select the text yourself." : ""}
        </p>
      </div>
      {needsName ? <HostNamePrompt onSave={onRenameMe} label="Add your name so the table knows which dishes are yours" /> : null}

      {mine ? (
        <Card section={mine} isMe pay={payOf(mine)}>
          <Lines section={mine} lineProps={lineProps} draftRound={draftRound} />
        </Card>
      ) : null}

      {people.length > 0 ? (
        <section aria-label="Everyone else" className="space-y-2">
          {people.map((s) => (
            <Card key={s.key} section={s} collapsible defaultOpen={startOpen.has(s.key)} pay={payOf(s)}>
              <Lines section={s} lineProps={lineProps} draftRound={draftRound} />
            </Card>
          ))}
        </section>
      ) : null}

      {shared.length > 0 ? (
        <section aria-label="Shared and unassigned" className="space-y-2">
          <h3 className="px-1 font-sans text-sm font-semibold text-ink-soft">Shared · settle at the table</h3>
          {shared.map((s) => (
            <Card key={s.key} section={s} collapsible defaultOpen={startOpen.has(s.key)}>
              <Lines section={s} lineProps={lineProps} draftRound={draftRound} />
            </Card>
          ))}
        </section>
      ) : null}

      <ServiceChargeBlock kkb={kkb} live={snapshot.settlement.serviceCharge} sessionId={snapshot.session.id} refresh={refresh} canEdit={isHost} isHost={isHost} />
      <AdjustmentsBlock kkb={kkb} snapshot={snapshot} refresh={refresh} isHost={isHost} />
      <ReceiptCheckBlock kkb={kkb} live={snapshot.settlement.receiptTotal} sessionId={snapshot.session.id} refresh={refresh} canEdit={isHost} snapshot={snapshot} />
      <PaymentsBlock totals={paymentTotals(kkb, payments)} snapshot={snapshot} isHost={isHost} onFix={isHost ? setFixing : null} refresh={refresh} />
      {isHost ? <PaymentSheet section={payingSection} status={payingSection ? statusOf(payingSection) : null} snapshot={snapshot} cards={kkb.sections.filter((s) => !s.shared)} refresh={refresh} onClose={() => setPaying(null)} /> : null}
      {isHost ? <FixPaymentSheet payment={payments.find((p) => p.id === fixing && p.needsReview) ?? null} snapshot={snapshot} cards={kkb.sections.filter((s) => !s.shared)} refresh={refresh} onClose={() => setFixing(null)} /> : null}
      {isHost ? <PricesSheet open={pricesOpen} onOpenChange={setPricesOpen} snapshot={snapshot} refresh={refresh} /> : null}
    </div>
  );
}

/** Jump to the first dish without a price: open its card, then focus its "Add price" button (or the row when it isn't yours to price). */
function showFirstUnpriced(key: string) {
  const row = document.querySelector<HTMLElement>(`[data-line="${CSS.escape(key)}"]`);
  const card = row?.closest("details");
  if (card) card.open = true;
  const target = row?.querySelector<HTMLElement>("button") ?? row;
  target?.scrollIntoView({ block: "center" });
  target?.focus();
}

function Completeness({ kkb, onEnterPrices }: { kkb: Kkb; onEnterPrices?: () => void }) {
  const { total, priced, first } = priceCompleteness(kkb);
  if (total === 0) return null;
  const link = "min-h-11 cursor-pointer font-semibold text-tomato-ink underline underline-offset-2";
  const prices = onEnterPrices ? (
    <span className="whitespace-nowrap">
      {" · "}
      <button type="button" onClick={onEnterPrices} className={link}>
        {first ? "Enter prices" : "Edit prices"}
      </button>
    </span>
  ) : null;
  const missing = total - priced;
  return (
    <p id="kkb-completeness" tabIndex={-1} className="text-sm text-ink outline-none">
      <span className="font-semibold whitespace-nowrap">{first ? `${priced} of ${total} dishes priced` : `All ${total === 1 ? "1 dish" : `${total} dishes`} priced`}</span>
      {first ? (
        <span className="whitespace-nowrap">
          {" · "}
          <button type="button" onClick={() => showFirstUnpriced(lineKey(kkb.sections.find((x) => x.key === first.sectionKey)!, first.line, false))} className={link}>
            Show the {missing === 1 ? "1 without a price" : `${missing} without a price`}
          </button>
        </span>
      ) : null}
      {prices}
    </p>
  );
}

function StatusStrip({ kkb, onEnterPrices }: { kkb: Kkb; onEnterPrices?: () => void }) {
  return (
    <div className="space-y-2">
      <Completeness kkb={kkb} onEnterPrices={onEnterPrices} />
      <ChargeStrip kkb={kkb} />
    </div>
  );
}

function ChargeStrip({ kkb }: { kkb: Kkb }) {
  const { charge } = kkb;
  if (charge.state === "allocated") {
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-ok-wash px-4 py-2.5 text-sm text-ink">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
        <span>
          Service charge <span className="tally font-semibold">{formatPeso(charge.centavos)}</span> is split by how much each person ordered.
        </span>
      </p>
    );
  }
  if (charge.state === "blocked") {
    const count = charge.blockers.length;
    return (
      <a href="#kkb-review" className="flex min-h-11 items-start gap-2 rounded-2xl bg-saffron-wash px-4 py-2.5 text-sm text-ink hover:brightness-95">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Service charge <span className="tally font-semibold">{formatPeso(charge.centavos)}</span> not yet allocated · {count === 1 ? "1 thing" : `${count} things`} to review
        </span>
      </a>
    );
  }
  return <p className="text-sm text-ink-soft">{charge.state === "none" ? "No service charge on this receipt." : "Service charge: not entered yet. It goes at the bottom, from the receipt."}</p>;
}

function noteOf(section: KkbSection, isMe: boolean) {
  if (isMe) return "you";
  if (section.kind === "group") return section.memberNames.length ? `shared by ${section.memberNames.join(", ")}` : "group";
  if (section.kind === "name") return "added by the host";
  return null;
}

/** What a person's card shows about payments: the chip beside the amount (once anything is recorded) and the rows at the end. */
type PayProps = { status: PaymentStatus | null; chip: boolean; rows: React.ReactNode };

const CHIP = {
  unpaid: { icon: Circle, text: "Unpaid", tone: "bg-paper text-ink-soft" },
  partly: { icon: Contrast, text: "Partly paid", tone: "bg-saffron-wash text-saffron-ink" },
  paid: { icon: CircleCheck, text: "Paid", tone: "bg-ok-wash text-ok" },
} as const;

function PayChip({ status }: { status: PaymentStatus | null }) {
  if (!status?.chip) return null;
  const { icon: Icon, text, tone } = CHIP[status.chip];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-sans text-xs font-semibold", tone)}>
      <Icon className="size-3.5" aria-hidden />
      {text}
    </span>
  );
}

function Card({ section, isMe = false, collapsible = false, defaultOpen = false, pay, children }: { section: KkbSection; isMe?: boolean; collapsible?: boolean; defaultOpen?: boolean; pay?: PayProps; children: React.ReactNode }) {
  const note = noteOf(section, isMe);
  const heading = (
    <div className="flex items-baseline justify-between gap-3">
      <p className="min-w-0 text-lg leading-snug">
        {section.title}
        {note ? <span className="ml-1.5 font-sans text-sm text-ink-soft">· {note}</span> : null}
      </p>
      <span className="flex shrink-0 flex-col items-end gap-y-1">
        <SummaryAmount section={section} />
        {pay?.chip ? <PayChip status={pay.status} /> : null}
      </span>
    </div>
  );
  if (!collapsible) {
    return (
      <section
        id={isMe ? MY_CARD_ID : undefined}
        tabIndex={isMe ? -1 : undefined}
        aria-label={`${section.title}, your share`}
        className={cn("ticket px-5 py-3", isMe && "ring-2 ring-tomato/40 focus:outline-2 focus:outline-offset-2 focus:outline-ink")}
      >
        {heading}
        {children}
        <Footer section={section} />
        {pay?.rows}
      </section>
    );
  }
  return (
    <details open={defaultOpen} className="ticket px-5 py-1">
      <summary className="flex min-h-12 cursor-pointer list-none items-center py-2 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">{heading}</div>
      </summary>
      <div className="pb-3">
        {children}
        <Footer section={section} />
        {pay?.rows}
      </div>
    </details>
  );
}

/** The one number on a card's heading: the total once allocated, else the food so far, plus what's missing. */
function SummaryAmount({ section }: { section: KkbSection }) {
  if (section.shared && section.lines.length > 0 && section.lines.every((l) => l.billedTo)) return <span className="shrink-0 text-sm text-ink-soft">All billed</span>;
  if (section.totalCentavos != null) return <span className="tally shrink-0 text-ink">{formatPeso(section.totalCentavos)}</span>;
  if (section.status === "none" || section.status === "empty") return <span className="shrink-0 text-sm text-ink-soft">{section.status === "none" ? "No prices yet" : "Not confirmed"}</span>;
  return (
    <span className="shrink-0 text-right">
      <span className="tally text-ink">{formatPeso(section.pricedCentavos)}</span>
      {section.unpricedUnits > 0 ? <span className="ml-1.5 rounded-full bg-saffron-wash px-2 py-0.5 font-sans text-xs font-semibold text-saffron-ink">{items(section.unpricedUnits)} no price</span> : null}
    </span>
  );
}

function Footer({ section }: { section: KkbSection }) {
  if (section.shared && section.lines.length > 0) {
    // Never "₱0.00 shared" for dishes nobody has priced yet: that reads like they were free.
    const counted = section.lines.filter((l) => !l.billedTo);
    if (counted.length === 0) return <p className="mt-2 border-t-[1.5px] border-dashed border-rule pt-2 text-sm text-ink-soft">Everything here is billed to someone.</p>;
    return (
      <p className="mt-2 border-t-[1.5px] border-dashed border-rule pt-2 text-sm text-ink-soft">
        {section.status === "none" ? "No prices yet" : <><span className="tally text-ink">{formatPeso(section.pricedCentavos)}</span> shared</>}
        {section.unpricedUnits > 0 ? ` · ${items(section.unpricedUnits)} without a price` : ""}
      </p>
    );
  }
  if (section.status === "empty") return null;
  const label = section.status === "complete" ? "Food subtotal" : section.status === "none" ? "No prices entered" : "Priced subtotal";
  const extra = [section.unpricedUnits > 0 ? `${items(section.unpricedUnits)} without a price` : null, section.pendingChanges > 0 ? "change pending" : null].filter(Boolean).join(" · ");
  return (
    <dl className="mt-2 space-y-0.5 border-t-[1.5px] border-dashed border-rule pt-2">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-sm text-ink-soft">
          {label}
          {extra ? <span className="block text-xs">{extra}</span> : null}
        </dt>
        {section.status !== "none" ? <dd className="tally text-ink">{formatPeso(section.pricedCentavos)}</dd> : null}
      </div>
      {section.totalCentavos != null && (section.serviceCentavos != null || section.adjustments.length > 0) ? (
        <>
          {section.serviceCentavos != null ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-ink-soft">Service charge</dt>
              <dd className="tally text-ink">{formatPeso(section.serviceCentavos)}</dd>
            </div>
          ) : null}
          {section.adjustments.map((a) => (
            <div key={a.id} className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-ink-soft">{a.label}</dt>
              <dd className="tally text-ink">{a.centavos < 0 ? "−" : "+"}{formatPeso(Math.abs(a.centavos))}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 pt-1">
            <dt className="font-semibold">{section.adjustments.length > 0 ? "Total" : "Total with service charge"}</dt>
            <dd className="tally text-2xl text-ink">{formatPeso(section.totalCentavos)}</dd>
          </div>
        </>
      ) : null}
    </dl>
  );
}

type LineProps = { rowKey: string; line: KkbLine; editing: boolean; canEdit: boolean; onEdit: () => void; editor: React.ReactNode };

function Lines({ section, lineProps, draftRound }: { section: KkbSection; lineProps: (s: KkbSection, l: KkbLine, draft: boolean) => LineProps; draftRound: number | null }) {
  return (
    <>
      {section.lines.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {section.lines.map((line) => (
            <LineRow key={lineKey(section, line, false)} {...lineProps(section, line, false)} />
          ))}
        </ul>
      ) : null}
      {section.drafts.length > 0 ? (
        <div className="mt-2">
          <p className="round-label text-xs">{draftRound ? `Round ${draftRound} · ` : ""}Not yet confirmed</p>
          <ul className="mt-1 space-y-1">
            {section.drafts.map((line) => (
              <LineRow key={lineKey(section, line, true)} {...lineProps(section, line, true)} />
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function LineRow({ rowKey, line, editing, canEdit, onEdit, editor }: LineProps) {
  const split = line.splitWays ? `split ${line.splitWays} ways` : null;
  // Short tags never break inside; the names tag may, for long names.
  const tags = [
    line.pendingChange ? { text: "Change pending with the waiter", keep: false } : null,
    split && line.billedFrom ? { text: split, keep: true } : null,
    line.billedFrom ? { text: `from ${line.billedFrom}`, keep: true } : null,
    line.billedTo ? { text: split ? `Split ${line.splitWays} ways: ${line.billedTo}` : `Billed to ${line.billedTo}`, keep: false } : null,
  ].filter((t) => t !== null);
  const amount = line.subtotalCentavos != null ? formatPeso(line.subtotalCentavos) : null;
  const action = amount ?? (line.billable && line.unitCentavos != null ? "Bill to…" : "Add price");
  return (
    <li data-line={rowKey} tabIndex={-1} className="rounded-lg focus-visible:bg-saffron-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 py-1 text-ink-soft">
          <p className={cn("break-words text-ink", line.billedTo && "text-ink-soft")}>
            {line.label} <span className="tally text-tomato-ink">×{line.quantity}</span>
          </p>
          <p className="text-xs">
            {line.splitOfCentavos != null ? (
              <span className="whitespace-nowrap">
                <span className="tally">{formatPeso(line.subtotalCentavos ?? 0)}</span> of <span className="tally">{formatPeso(line.splitOfCentavos)}</span>
              </span>
            ) : line.unitCentavos != null ? <span className="tally">{formatPeso(line.unitCentavos)} each</span> : "No price yet"}
            {line.splitOfCentavos != null ? "" : line.priceSource === "table" ? " · table price" : line.priceSource === "line" && line.hasTable ? " · this line only" : ""}
            {tags.map((t) => (
              <Fragment key={t.text}>
                {" · "}
                <span className={t.keep ? "whitespace-nowrap" : undefined}>{t.text}</span>
              </Fragment>
            ))}
          </p>
        </div>
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${amount ? `Edit price ${amount}` : action}, ${line.label}`}
            className={cn(
              "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 font-semibold",
              amount ? "tally text-ink hover:bg-ink/6" : "border-[1.5px] border-dashed border-input text-sm text-ink hover:bg-paper",
            )}
          >
            {action}
            {amount ? <Pencil className="size-3.5 text-ink-soft" aria-hidden /> : null}
          </button>
        ) : (
          <span className={cn("tally shrink-0", amount ? "text-ink" : "text-sm text-ink-soft")}>{amount ?? "—"}</span>
        )}
      </div>
      {editing ? editor : null}
    </li>
  );
}
