"use client";

import { CircleAlert, CircleCheck, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { buildKkb, type Kkb, type KkbLine, type KkbSection } from "@/lib/kkb";
import { formatPeso } from "@/lib/money";
import type { SessionSnapshot } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { HostNamePrompt } from "./host-name-prompt";
import { PriceEditor, type Payer } from "./price-editor";
import { ServiceChargeBlock } from "./service-charge-block";

interface KkbViewProps {
  snapshot: SessionSnapshot;
  refresh: () => Promise<unknown>;
  onRenameMe: (displayName: string) => void;
}

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;
const lineKey = (section: KkbSection, line: KkbLine, draft: boolean) => `${section.key}|${line.entryId}|${line.correctionId ?? ""}|${draft ? "d" : "c"}`;

/**
 * KKB inside "Who ordered what": each person's food from confirmed rounds, then shared dishes, then the receipt's
 * service charge split by food once nothing is missing. The viewer's own card comes first; the host can price
 * anything, guests the dishes they added.
 */
export function KkbView({ snapshot, refresh, onRenameMe }: KkbViewProps) {
  const meId = snapshot.me.participantId;
  const isHost = snapshot.me.role === "HOST";
  const isOpen = snapshot.session.status === "OPEN";
  const kkb = useMemo(() => buildKkb(snapshot, meId), [snapshot, meId]);
  const [editing, setEditing] = useState<string | null>(null);
  // Which cards start open is decided once, so a card doesn't snap shut while the host is pricing it.
  const [startOpen] = useState(() => new Set(kkb.sections.filter((s) => s.shared || (isHost && (s.unpricedUnits > 0 || s.drafts.some((l) => l.unitCentavos == null)))).map((s) => s.key)));
  const payers: Payer[] = useMemo(
    () => [
      ...snapshot.participants.map((p) => ({ key: `p:${p.id}`, title: p.id === meId ? `${p.displayName} (you)` : p.displayName, participantId: p.id, label: null })),
      ...kkb.sections.filter((s) => s.kind === "name").map((s) => ({ key: `n:${s.title.toLowerCase()}`, title: s.title, participantId: null, label: s.title })),
    ],
    [snapshot.participants, kkb.sections, meId],
  );

  if (kkb.sections.length === 0) {
    return <p className="mt-6 rounded-2xl bg-paper px-4 py-6 text-center text-ink-soft">Nothing ordered yet. Prices show up here once there are dishes.</p>;
  }

  const lineProps = (section: KkbSection, line: KkbLine, draft: boolean): LineProps => {
    const key = lineKey(section, line, draft);
    const live = line.correctionId
      ? { unitCentavos: snapshot.settlement.corrections[line.correctionId]?.unitCentavos ?? null, billTo: null, revision: snapshot.settlement.corrections[line.correctionId]?.revision ?? 0 }
      : (snapshot.settlement.entries[line.entryId] ?? { unitCentavos: null, billTo: null, revision: 0 });
    const canPrice = isOpen && (line.correctionId ? isHost : isHost || line.submittedBy === meId);
    const canBillTo = isOpen && isHost && line.billable && !line.correctionId && !draft;
    return {
      line,
      editing: editing === key,
      canEdit: canPrice || canBillTo,
      onEdit: () => setEditing(key),
      editor: <PriceEditor key={key} line={line} sessionId={snapshot.session.id} refresh={refresh} canPrice={canPrice} canBillTo={canBillTo} payers={payers} live={live} onDone={() => setEditing((open) => (open === key ? null : open))} />,
    };
  };

  const mine = kkb.sections.find((s) => s.isMe);
  const people = kkb.sections.filter((s) => !s.isMe && !s.shared);
  const shared = kkb.sections.filter((s) => s.shared);
  const needsName = isHost && isOpen && snapshot.me.displayName.trim().toLowerCase() === "host";

  return (
    <div className="mt-4 space-y-4" data-ph-mask="">
      <StatusStrip kkb={kkb} />
      {needsName ? <HostNamePrompt onSave={onRenameMe} label="Add your name so the table knows which dishes are yours" /> : null}

      {mine ? (
        <Card section={mine} isMe>
          <Lines section={mine} lineProps={lineProps} />
        </Card>
      ) : null}

      {people.length > 0 ? (
        <section aria-label="Everyone else" className="space-y-2">
          {people.map((s) => (
            <Card key={s.key} section={s} collapsible defaultOpen={startOpen.has(s.key)}>
              <Lines section={s} lineProps={lineProps} />
            </Card>
          ))}
        </section>
      ) : null}

      {shared.length > 0 ? (
        <section aria-label="Shared and unassigned" className="space-y-2">
          <h3 className="px-1 font-sans text-sm font-semibold text-ink-soft">Shared · settle at the table</h3>
          {shared.map((s) => (
            <Card key={s.key} section={s} collapsible defaultOpen={startOpen.has(s.key)}>
              <Lines section={s} lineProps={lineProps} />
            </Card>
          ))}
        </section>
      ) : null}

      <ServiceChargeBlock kkb={kkb} live={snapshot.settlement.serviceCharge} sessionId={snapshot.session.id} refresh={refresh} canEdit={isHost && isOpen} isHost={isHost} />
    </div>
  );
}

function StatusStrip({ kkb }: { kkb: Kkb }) {
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
  return <p className="px-1 text-sm text-ink-soft">{charge.state === "none" ? "No service charge on this receipt." : "Service charge: not entered yet. It goes at the bottom, from the receipt."}</p>;
}

function noteOf(section: KkbSection, isMe: boolean) {
  if (isMe) return "you";
  if (section.kind === "group") return section.memberNames.length ? `shared by ${section.memberNames.join(", ")}` : "group";
  if (section.kind === "name") return "added by the host";
  return null;
}

function Card({ section, isMe = false, collapsible = false, defaultOpen = false, children }: { section: KkbSection; isMe?: boolean; collapsible?: boolean; defaultOpen?: boolean; children: React.ReactNode }) {
  const note = noteOf(section, isMe);
  const heading = (
    <div className="flex items-baseline justify-between gap-3">
      <p className="min-w-0 text-lg leading-snug">
        {section.title}
        {note ? <span className="ml-1.5 font-sans text-sm text-ink-soft">· {note}</span> : null}
      </p>
      <SummaryAmount section={section} />
    </div>
  );
  if (!collapsible) {
    return (
      <section aria-label={`${section.title}, your share`} className={cn("ticket px-5 py-3", isMe && "ring-2 ring-tomato/40")}>
        {heading}
        {children}
        <Footer section={section} />
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
      {section.serviceCentavos != null && section.totalCentavos != null ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-ink-soft">Service charge</dt>
            <dd className="tally text-ink">{formatPeso(section.serviceCentavos)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 pt-1">
            <dt className="font-semibold">Total with service charge</dt>
            <dd className="tally text-2xl text-ink">{formatPeso(section.totalCentavos)}</dd>
          </div>
        </>
      ) : null}
    </dl>
  );
}

type LineProps = { line: KkbLine; editing: boolean; canEdit: boolean; onEdit: () => void; editor: React.ReactNode };

function Lines({ section, lineProps }: { section: KkbSection; lineProps: (s: KkbSection, l: KkbLine, draft: boolean) => LineProps }) {
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
          <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Not yet confirmed</p>
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

function LineRow({ line, editing, canEdit, onEdit, editor }: LineProps) {
  const tags = [line.pendingChange ? "Change pending with the waiter" : null, line.billedFrom ? `from ${line.billedFrom}` : null, line.billedTo ? `Billed to ${line.billedTo}` : null].filter(Boolean);
  const amount = line.subtotalCentavos != null ? formatPeso(line.subtotalCentavos) : null;
  const action = amount ?? (line.billable && line.unitCentavos != null ? "Bill to…" : "Add price");
  return (
    <li>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 py-1 text-ink-soft">
          <p className={cn("break-words text-ink", line.billedTo && "text-ink-soft")}>
            {line.label} <span className="tally text-tomato-ink">×{line.quantity}</span>
          </p>
          <p className="text-xs">
            {line.unitCentavos != null ? <span className="tally">{formatPeso(line.unitCentavos)} each</span> : "No price yet"}
            {tags.length ? ` · ${tags.join(" · ")}` : ""}
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
