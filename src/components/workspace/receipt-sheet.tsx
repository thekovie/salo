"use client";

import { LoaderCircle, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useDirectSave, useRetryOnReconnect } from "@/hooks/use-direct-save";
import { personKey } from "@/lib/adjustments";
import { buildKkb } from "@/lib/kkb";
import { receiptName } from "@/lib/receipts";
import { formatPeso, MAX_SERVICE_CHARGE_CENTAVOS, parsePeso, toPesoInput } from "@/lib/money";
import type { SessionSnapshot, SnapshotReceipt } from "@/lib/snapshot";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The receipt being edited; null adds one. */
  existing: SnapshotReceipt | null;
  snapshot: SessionSnapshot;
  refresh: () => Promise<unknown>;
}

interface Person {
  key: string;
  name: string;
  participantId: string | null;
  label: string | null;
  /** Salo's amount for them: their card total. */
  centavos: number;
  /** The label of the other receipt they are on. */
  elsewhere: string | null;
}

function peopleOf(snapshot: SessionSnapshot, mine: SnapshotReceipt | null): Person[] {
  const kkb = buildKkb(snapshot, snapshot.me.participantId);
  const others = new Map(snapshot.settlement.receipts.filter((r) => r.id !== mine?.id).flatMap((r) => r.people.map((p) => [personKey(p), receiptName(snapshot.settlement.receipts, r)] as const)));
  const list: Person[] = kkb.sections.filter((s) => !s.shared && (s.pricedCentavos > 0 || mine?.people.some((p) => personKey(p) === s.key))).map((s) => ({ key: s.key, name: s.title, participantId: s.participantId, label: s.participantId ? null : s.title, centavos: s.totalCentavos ?? s.pricedCentavos, elsewhere: others.get(s.key) ?? null }));
  for (const p of mine?.people ?? []) {
    if (list.some((x) => x.key === personKey(p))) continue;
    const name = snapshot.participants.find((x) => x.id === p.participantId)?.displayName ?? snapshot.removedPeople.find((x) => x.id === p.participantId)?.displayName ?? p.label ?? "Someone";
    list.push({ key: personKey(p), name, participantId: p.participantId, label: p.label, centavos: 0, elsewhere: null });
  }
  return list;
}

export function ReceiptSheet({ open, onOpenChange, existing, snapshot, refresh }: SheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>{open ? <SheetBody existing={existing} snapshot={snapshot} refresh={refresh} onClose={() => onOpenChange(false)} /> : null}</DrawerContent>
    </Drawer>
  );
}

function SheetBody({ existing, snapshot, refresh, onClose }: Omit<SheetProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const id = useId();
  const [receiptId] = useState(() => existing?.id ?? crypto.randomUUID());
  const { state, save } = useDirectSave(refresh);
  const live = snapshot.settlement.receipts.find((r) => r.id === receiptId);
  const [seed, setSeed] = useState(existing);
  const [baseRevision, setBaseRevision] = useState(existing?.revision ?? 0);
  const [formKey, setFormKey] = useState(0);
  const changedElsewhere = existing != null && (!live || live.revision !== baseRevision);
  const people = useMemo(() => peopleOf(snapshot, seed), [snapshot, seed]);
  return (
    <Form key={formKey} {...{ id, receiptId, seed, baseRevision, people, snapshot, state, save, onClose, existing }}>
      {changedElsewhere ? (
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
                    setFormKey((k) => k + 1);
                  }}
                >
                  Use theirs
                </Button>
                <Button variant="ghost" onClick={() => setBaseRevision(live.revision)}>
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
      ) : null}
    </Form>
  );
}

interface FormProps {
  id: string;
  receiptId: string;
  existing: SnapshotReceipt | null;
  seed: SnapshotReceipt | null;
  baseRevision: number;
  people: Person[];
  snapshot: SessionSnapshot;
  state: ReturnType<typeof useDirectSave>["state"];
  save: ReturnType<typeof useDirectSave>["save"];
  onClose: () => void;
  children: React.ReactNode;
}

function Form({ id, receiptId, existing, seed, baseRevision, people, snapshot, state, save, onClose, children }: FormProps) {
  const [label, setLabel] = useState(seed?.label ?? "");
  const [ticked, setTicked] = useState<string[]>((seed?.people ?? []).map(personKey));
  const [totalText, setTotalText] = useState(toPesoInput(seed?.totalCentavos ?? null));
  const [removing, setRemoving] = useState(false);
  const total = parsePeso(totalText, MAX_SERVICE_CHARGE_CENTAVOS);
  const chosen = people.filter((p) => ticked.includes(p.key));
  const canSave = total.ok && chosen.length > 0;
  const url = `/api/sessions/${snapshot.session.id}/receipts/${receiptId}`;
  const submit = async () => {
    if (!canSave || !total.ok) return;
    const body = { expectedRevision: baseRevision, label: label.trim() || null, totalCentavos: total.centavos, people: chosen.map((p) => (p.participantId ? { participantId: p.participantId } : { label: p.label })) };
    if (await save(url, "PUT", body)) onClose();
  };
  const remove = async () => {
    if (await save(url, "DELETE", { expectedRevision: baseRevision })) onClose();
  };
  useRetryOnReconnect(state.kind === "error" && state.retryable, () => void (removing ? remove() : submit()));
  const saving = state.kind === "saving";
  const salo = chosen.reduce((sum, p) => sum + p.centavos, 0);
  const names = chosen.map((p) => p.name).join(", ");

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
          <DrawerTitle className="font-display text-2xl font-medium">{existing ? "Edit receipt" : "Add a receipt"}</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-ink-soft">For a second bill, like a senior citizen or PWD receipt.</DrawerDescription>
        </div>
        <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
          <X className="size-5" aria-hidden />
        </DrawerClose>
      </div>
      {children}

      <label className="mt-3 block text-sm font-semibold">
        Label <span className="font-normal text-ink-soft">optional</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoComplete="off" placeholder="e.g. Senior citizen receipt" className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base font-normal" />
      </label>

      <fieldset className="mt-3">
        <legend className="text-sm font-semibold">Who it covers</legend>
        <ul>
          {people.map((p) => (
            <li key={p.key}>
              <label className="flex min-h-11 items-center gap-2.5 break-words">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-tomato"
                  checked={ticked.includes(p.key)}
                  disabled={p.elsewhere != null}
                  onChange={(e) => setTicked(e.target.checked ? [...ticked, p.key] : ticked.filter((k) => k !== p.key))}
                />
                <span className="min-w-0 flex-1">
                  {p.name}
                  {p.elsewhere ? <span className="ml-1.5 text-sm text-ink-soft">on {p.elsewhere}</span> : null}
                </span>
                {p.elsewhere == null ? <span className="tally shrink-0 text-ink-soft">{formatPeso(p.centavos)}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <label className="mt-3 block text-sm font-semibold">
        Receipt total (₱)
        <input
          value={totalText}
          onChange={(e) => setTotalText(e.target.value)}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          placeholder="e.g. 513"
          aria-invalid={!total.ok || undefined}
          aria-describedby={`${id}-effect`}
          className="tally mt-1 block min-h-11 w-full min-w-0 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base font-normal aria-invalid:border-bad"
        />
      </label>
      <p id={`${id}-effect`} aria-live="polite" className="mt-1 text-sm text-ink-soft">
        {!total.ok ? <span className="text-bad">{total.message}</span> : chosen.length === 0 ? "Pick who this receipt covers." : <>Salo has <span className="tally text-ink">{formatPeso(salo)}</span> for {names}. Everyone else stays on the main receipt.</>}
      </p>

      {state.kind === "error" ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad">
          <span className="flex-1">Not saved. {state.message}</span>
          {state.retryable ? (
            <button type="button" onClick={() => void (removing ? remove() : submit())} className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-bad px-3 font-semibold hover:bg-bad/10">
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
          <div role="group" aria-label="Remove this receipt?" className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Remove this receipt?</span>
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
