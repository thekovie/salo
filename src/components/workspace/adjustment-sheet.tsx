"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useDirectSave, useRetryOnReconnect } from "@/hooks/use-direct-save";
import { adjustmentCategoryLabel, percentOf, personKey } from "@/lib/adjustments";
import { buildKkb, type Kkb } from "@/lib/kkb";
import { formatPeso, MAX_SERVICE_CHARGE_CENTAVOS, parsePeso, toPesoInput } from "@/lib/money";
import { ADJUSTMENT_CATEGORIES, type AdjustmentCategory, type AdjustmentMethod, type SessionSnapshot, type SnapshotAdjustment } from "@/lib/snapshot";
import { cn } from "@/lib/utils";

const METHODS: { value: AdjustmentMethod; label: string }[] = [
  { value: "individual", label: "One person" },
  { value: "proportional", label: "Split by what each ordered" },
  { value: "equal", label: "Split equally" },
  { value: "manual", label: "Exact amounts" },
  { value: "unallocated", label: "Decide later" },
];
const field = "min-h-11 min-w-0 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base aria-invalid:border-bad";

interface Person {
  key: string;
  name: string;
  participantId: string | null;
  label: string | null;
}


/** "10" or "12.5" → basis points, or null when it isn't a percent from 0.01 to 100. */
function parsePercent(text: string): number | null {
  const cleaned = text.replace(/[%\s]/g, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  return bps >= 1 && bps <= 10000 ? bps : null;
}

const pesos = (text: string | undefined) => {
  const parsed = parsePeso(text ?? "", MAX_SERVICE_CHARGE_CENTAVOS);
  return parsed.ok ? parsed.centavos : null;
};

/** Everyone with food on a card, plus anyone the adjustment already names, so a flagged person can still be unticked. */
function peopleOf(snapshot: SessionSnapshot, seed: SnapshotAdjustment | null): Person[] {
  const kkb = buildKkb(snapshot, snapshot.me.participantId);
  const list: Person[] = kkb.sections.filter((s) => !s.shared && s.pricedCentavos > 0).map((s) => ({ key: s.key, name: s.title, participantId: s.participantId, label: s.participantId ? null : s.title }));
  for (const sh of seed?.shares ?? []) {
    if (list.some((p) => p.key === personKey(sh))) continue;
    const name = snapshot.participants.find((p) => p.id === sh.participantId)?.displayName ?? snapshot.removedPeople.find((p) => p.id === sh.participantId)?.displayName ?? sh.label ?? "Someone";
    list.push({ key: personKey(sh), name, participantId: sh.participantId, label: sh.label });
  }
  return list;
}

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The adjustment being edited; null adds a new one. */
  existing: SnapshotAdjustment | null;
  snapshot: SessionSnapshot;
  refresh: () => Promise<unknown>;
}

export function AdjustmentSheet({ open, onOpenChange, existing, snapshot, refresh }: SheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>{open ? <SheetBody existing={existing} snapshot={snapshot} refresh={refresh} onClose={() => onOpenChange(false)} /> : null}</DrawerContent>
    </Drawer>
  );
}

function SheetBody({ existing, snapshot, refresh, onClose }: Omit<SheetProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const id = useId();
  const [adjustmentId] = useState(() => existing?.id ?? crypto.randomUUID());
  const { state, save } = useDirectSave(refresh);
  const live = snapshot.settlement.adjustments.find((a) => a.id === adjustmentId);
  const [seed, setSeed] = useState(existing);
  const [baseRevision, setBaseRevision] = useState(existing?.revision ?? 0);
  const [formKey, setFormKey] = useState(0);
  const [keepMine, setKeepMine] = useState(0);
  const changedElsewhere = existing != null && (!live || live.revision !== baseRevision);
  const people = useMemo(() => peopleOf(snapshot, seed), [snapshot, seed]);

  return (
    <Form
      key={formKey}
      {...{ id, adjustmentId, seed, baseRevision, people, snapshot, state, save, onClose, existing, keepMine }}
      conflictBanner={
        changedElsewhere ? (
          <div role="alert" className="mt-3 rounded-xl bg-saffron-wash px-3 py-2 text-sm text-ink">
            <p>{live ? "Changed just now. Your changes are still here." : "This was removed just now."}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {live ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSeed(live);
                      setBaseRevision(live.revision);
                      setKeepMine(0);
                      setFormKey((k) => k + 1);
                    }}
                  >
                    Use theirs
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBaseRevision(live.revision);
                      setKeepMine((n) => n + 1);
                    }}
                  >
                    Keep mine
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
              )}
            </div>
          </div>
        ) : null
      }
    />
  );
}

interface FormProps {
  id: string;
  adjustmentId: string;
  existing: SnapshotAdjustment | null;
  seed: SnapshotAdjustment | null;
  baseRevision: number;
  people: Person[];
  snapshot: SessionSnapshot;
  state: ReturnType<typeof useDirectSave>["state"];
  save: ReturnType<typeof useDirectSave>["save"];
  onClose: () => void;
  conflictBanner: React.ReactNode;
  /** Bumped by "Keep mine": save at once on the new base revision, as the Prices sheet does. */
  keepMine: number;
}

function Form({ id, adjustmentId, existing, seed, baseRevision, people, snapshot, state, save, onClose, conflictBanner, keepMine }: FormProps) {
  const [direction, setDirection] = useState(seed?.direction ?? "discount");
  const [category, setCategory] = useState<AdjustmentCategory>(seed?.category ?? "senior");
  const [note, setNote] = useState(seed?.note ?? "");
  const [byPercent, setByPercent] = useState(seed?.percentBps != null);
  const [amountText, setAmountText] = useState(seed?.amountCentavos != null ? toPesoInput(seed.amountCentavos) : seed?.percentBps != null ? String(seed.percentBps / 100) : "");
  const [method, setMethod] = useState<AdjustmentMethod>(seed?.method ?? "individual");
  const seeded = (seed?.shares ?? []).map(personKey);
  const [one, setOne] = useState(seeded[0] ?? people[0]?.key ?? "");
  const [ticked, setTicked] = useState<string[]>(seeded.length > 0 && seed?.method !== "individual" ? seeded : people.map((p) => p.key));
  const [exact, setExact] = useState<Record<string, string>>(() => Object.fromEntries((seed?.shares ?? []).map((s) => [personKey(s), toPesoInput(s.amountCentavos)])));
  const [removing, setRemoving] = useState(false);

  const percentBps = byPercent ? parsePercent(amountText) : null;
  const parsed = byPercent ? null : parsePeso(amountText, MAX_SERVICE_CHARGE_CENTAVOS);
  const fixed = parsed?.ok ? parsed.centavos : null;
  const amountOk = byPercent ? percentBps != null : fixed != null && fixed > 0;
  const chosen = method === "individual" ? (one ? [one] : []) : method === "unallocated" ? [] : method === "manual" ? people.filter((p) => (pesos(exact[p.key]) ?? 0) > 0).map((p) => p.key) : ticked;
  const shares = chosen.flatMap((key) => {
    const p = people.find((x) => x.key === key);
    return p ? [{ participantId: p.participantId, label: p.participantId ? null : p.label, amountCentavos: method === "manual" ? pesos(exact[key]) : null }] : [];
  });
  const manualLeft = method === "manual" && fixed != null ? fixed - shares.reduce((sum, s) => sum + (s.amountCentavos ?? 0), 0) : 0;
  const canSave = amountOk && (method === "unallocated" || shares.length > 0) && manualLeft === 0;

  const draft: SnapshotAdjustment = { id: adjustmentId, direction, category, note: note.trim() || null, amountCentavos: byPercent ? null : fixed, percentBps: byPercent ? percentBps : null, method, shares, revision: baseRevision };
  const draftJson = JSON.stringify(draft);
  const effect = useMemo(() => {
    if (!canSave) return null;
    const draftValue = JSON.parse(draftJson) as SnapshotAdjustment;
    const others = snapshot.settlement.adjustments.filter((a) => a.id !== adjustmentId);
    const run = (list: SnapshotAdjustment[]) => buildKkb({ ...snapshot, settlement: { ...snapshot.settlement, adjustments: list } }, snapshot.me.participantId);
    return { before: run(others), after: run([...others, draftValue]) };
  }, [snapshot, canSave, draftJson, adjustmentId]);
  const result = effect?.after.adjustments.find((a) => a.id === adjustmentId);

  const url = `/api/sessions/${snapshot.session.id}/adjustments/${adjustmentId}`;
  const submit = async () => {
    if (!canSave) return;
    const body = {
      expectedRevision: baseRevision,
      direction,
      category,
      note: note.trim() || null,
      ...(byPercent ? { percentBps } : { amountCentavos: fixed }),
      method,
      shares: shares.map((s) => ({ ...(s.participantId ? { participantId: s.participantId } : { billToLabel: s.label }), ...(method === "manual" ? { amountCentavos: s.amountCentavos } : {}) })),
    };
    if (await save(url, "PUT", body)) onClose();
  };
  const remove = async () => {
    if (await save(url, "DELETE", { expectedRevision: baseRevision })) onClose();
  };
  useEffect(() => {
    if (keepMine > 0) void submit();
    // Runs once per "Keep mine" tap, after the new base revision has rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepMine]);
  const retry = () => void (removing ? remove() : submit());
  useRetryOnReconnect(state.kind === "error" && state.retryable, retry);
  const saving = state.kind === "saving";
  const percentBasis = result?.basisCentavos ?? null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      aria-busy={saving}
      data-ph-mask=""
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <DrawerTitle className="font-display text-2xl font-medium">{existing ? `Edit ${direction === "charge" ? "charge" : "discount"}` : "Add discount or charge"}</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-ink-soft">Copy what the receipt shows.</DrawerDescription>
        </div>
        <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
          <X className="size-5" aria-hidden />
        </DrawerClose>
      </div>
      {conflictBanner}

      <fieldset className="mt-3 flex flex-wrap gap-x-2">
        <legend className="sr-only">Type</legend>
        <Radio name={`${id}-dir`} checked={direction === "discount"} onChange={() => setDirection("discount")} label="Discount" />
        <Radio name={`${id}-dir`} checked={direction === "charge"} onChange={() => setDirection("charge")} label="Extra charge" />
      </fieldset>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          Reason
          <select value={category} onChange={(e) => setCategory(e.target.value as AdjustmentCategory)} className={cn(field, "mt-1 block w-full font-normal")}>
            {ADJUSTMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {adjustmentCategoryLabel(c)}
              </option>
            ))}
          </select>
          {category === "other" ? <span className="mt-1 block text-sm font-normal text-ink-soft">Credit? Choose Discount, Other.</span> : null}
        </label>
        <label className="block text-sm font-semibold">
          Note <span className="font-normal text-ink-soft">optional</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={40} autoComplete="off" aria-describedby={`${id}-note`} className={cn(field, "mt-1 block w-full font-normal")} />
        </label>
      </div>
      <p id={`${id}-note`} className="mt-1 text-sm text-ink-soft">
        Everyone at the table sees this. Don’t type ID numbers.
      </p>

      <fieldset className="mt-3">
        <legend className="text-sm font-semibold">Amount</legend>
        <div className="mt-1 flex flex-wrap items-center gap-x-2">
          <Radio name={`${id}-mode`} checked={!byPercent} onChange={() => setByPercent(false)} label="₱" />
          <Radio name={`${id}-mode`} checked={byPercent} onChange={() => setByPercent(true)} disabled={method === "manual" || method === "unallocated"} label="%" />
          <input
            aria-label={byPercent ? "Percent" : "Amount in pesos"}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder={byPercent ? "0" : "0.00"}
            aria-invalid={(amountText !== "" && !amountOk) || undefined}
            className={cn(field, "tally w-32 text-right")}
          />
        </div>
        {byPercent && percentBps != null && percentBasis != null ? (
          <p className="mt-1 text-sm text-ink-soft">
            = {formatPeso(percentOf(percentBps, percentBasis))} of selected food {formatPeso(percentBasis)}
          </p>
        ) : null}
        {parsed && !parsed.ok ? <p className="mt-1 text-sm text-bad">{parsed.message}</p> : null}
      </fieldset>

      <fieldset className="mt-3">
        <legend className="text-sm font-semibold">Who it applies to</legend>
        {METHODS.map((m) => (
          <div key={m.value}>
            <Radio
              name={`${id}-method`}
              checked={method === m.value}
              onChange={() => {
                setMethod(m.value);
                if (m.value === "manual" || m.value === "unallocated") setByPercent(false);
              }}
              label={m.label}
            />
            {method === m.value && m.value === "individual" ? (
              <select aria-label="Who" value={one} onChange={(e) => setOne(e.target.value)} className={cn(field, "mb-1 block w-full font-normal")}>
                {people.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
            {method === m.value && (m.value === "proportional" || m.value === "equal") ? (
              <ul className="mb-1">
                {people.map((p) => (
                  <li key={p.key}>
                    <label className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" className="size-5 accent-tomato" checked={ticked.includes(p.key)} onChange={(e) => setTicked(e.target.checked ? [...ticked, p.key] : ticked.filter((k) => k !== p.key))} />
                      {p.name}
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {method === m.value && m.value === "manual" ? (
              <ul className="mb-1 space-y-1">
                {people.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-3">
                    <label htmlFor={`${id}-x-${p.key}`}>{p.name}</label>
                    <input id={`${id}-x-${p.key}`} value={exact[p.key] ?? ""} onChange={(e) => setExact({ ...exact, [p.key]: e.target.value })} inputMode="decimal" autoComplete="off" placeholder="0.00" className={cn(field, "tally w-28 text-right")} />
                  </li>
                ))}
                {fixed != null && manualLeft !== 0 ? (
                  <li role="status" className="text-sm text-bad">
                    {manualLeft > 0 ? `${formatPeso(manualLeft)} left to assign` : `${formatPeso(-manualLeft)} over`}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ))}
      </fieldset>

      <Effect effect={effect} state={result?.state} problems={result?.problems ?? []} shares={result?.shares ?? []} />

      {state.kind === "error" ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad">
          <span className="flex-1">Not saved. {state.message}</span>
          {state.retryable ? (
            <button type="button" onClick={retry} className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-bad px-3 font-semibold hover:bg-bad/10">
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {state.kind === "conflict" ? (
        <p role="alert" className="mt-3 rounded-xl bg-saffron-wash px-3 py-2 text-sm text-ink">
          Someone changed this just now. Your changes are still here.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button type="submit" disabled={saving || !canSave}>
          {saving && !removing ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
          {saving && !removing ? "Saving…" : "Save"}
        </Button>
        {existing && !removing ? (
          <Button variant="danger" disabled={saving} onClick={() => setRemoving(true)}>
            Remove
          </Button>
        ) : null}
        {removing ? (
          <div role="group" aria-label="Remove this?" className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Remove this?</span>
            <Button variant="danger" disabled={saving} onClick={() => void remove()}>
              Yes, remove
            </Button>
            <Button variant="ghost" disabled={saving} onClick={() => setRemoving(false)}>
              Keep
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}

function Effect({ effect, state, problems, shares }: { effect: { before: Kkb; after: Kkb } | null; state: string | undefined; problems: string[]; shares: { key: string; name: string }[] }) {
  const total = (k: Kkb, key: string) => {
    const s = k.sections.find((x) => x.key === key);
    return s ? (s.totalCentavos ?? s.pricedCentavos) : 0;
  };
  return (
    <section aria-label="Effect" aria-live="polite" className="mt-3 rounded-xl bg-paper px-3 py-2.5 text-sm">
      <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Effect</h3>
      {!effect ? (
        <p className="text-ink-soft">Fill in the amount and who it applies to to see the effect.</p>
      ) : state === "waiting" ? (
        <p className="text-ink-soft">Waiting for prices. Shares show once every dish has a price.</p>
      ) : state === "unallocated" ? (
        <p className="text-ink-soft">Not assigned yet. Nobody’s share changes, and totals read “so far”.</p>
      ) : state === "flagged" ? (
        <ul className="text-bad">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-2 gap-y-0.5 text-base">
          {shares.map((s) => (
            <li key={s.key} className="contents">
              <span className="min-w-0 break-words">{s.name}</span>
              <span className="tally text-right">{formatPeso(total(effect.before, s.key))}</span>
              <span aria-hidden>→</span>
              <span className="tally text-right">
                <span className="sr-only">to </span>
                {formatPeso(total(effect.after, s.key))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Radio({ checked, onChange, name, label, disabled }: { checked: boolean; onChange: () => void; name: string; label: string; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 pr-3", disabled && "cursor-default opacity-45")}>
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="size-5 accent-tomato" />
      {label}
    </label>
  );
}
