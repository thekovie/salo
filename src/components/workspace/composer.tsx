"use client";

import { ChevronDown, Plus, UserRound, UsersRound, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { AddInput } from "@/hooks/use-session";
import { track } from "@/lib/analytics";
import { normalizeText } from "@/lib/dish-name";
import { splitDishName, variantSuggestions } from "@/lib/dish-details";
import { parsePeso } from "@/lib/money";
import { attributionOf, summary, type Recipient } from "@/lib/recipient";
import { DetailFields, type DetailField } from "./detail-fields";
import { RecipientPicker } from "./recipient-picker";
import { cn } from "@/lib/utils";
import { Stepper } from "./stepper";

const MAX_SUGGESTIONS = 4;

interface ComposerProps {
  dishNames: string[];
  /** Other people with a phone in this order (not me, not removed). */
  people: { id: string; displayName: string }[];
  /** Names typed for people without a phone. */
  names: string[];
  /** Group labels already used in this order. */
  groups: string[];
  /** Dishes already in this order, for size suggestions. */
  entries: { dishName: string; variant: string | null }[];
  disabled?: boolean;
  /** Changes when the person switches tab: the "who's it for" panel closes so it doesn't cover the new view. */
  view?: string;
  onAdd: (input: AddInput) => void;
  /** Bumped by the setup guide's "Try it": opens the Price field. */
  detailsSignal?: number;
}

function suggestionsFor(query: string, names: string[]): string[] {
  const q = normalizeText(query);
  if (!q) return [];
  const starts = names.filter((n) => normalizeText(n).startsWith(q));
  const contains = names.filter((n) => !normalizeText(n).startsWith(q) && normalizeText(n).includes(q));
  return [...starts, ...contains].filter((n) => normalizeText(n) !== q).slice(0, MAX_SUGGESTIONS);
}

/**
 * Quick entry (brief 5.4). Row one is the dish, full width. Row two says who it's for (one tap opens the choices),
 * the quantity, and Add. Size, note and price are chips under the dish.
 * After adding: dish, quantity, size and instructions reset; the recipient stays for the next dish.
 */
export function Composer({ dishNames, people, names, groups, entries, disabled, view, onAdd, detailsSignal = 0 }: ComposerProps) {
  const id = useId();
  const dishRef = useRef<HTMLInputElement>(null);
  const [dish, setDish] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [open, setOpen] = useState(false);
  const [lastView, setLastView] = useState(view);
  if (view !== lastView) {
    setLastView(view);
    setOpen(false);
  }
  const [field, setField] = useState<DetailField | null>(null);
  const [lastSignal, setLastSignal] = useState(detailsSignal);
  if (detailsSignal !== lastSignal) {
    setLastSignal(detailsSignal);
    setField("price");
  }
  const [recipient, setRecipient] = useState<Recipient>({ kind: "ME" });
  const [typed, setTyped] = useState("");
  const [variant, setVariant] = useState("");
  const [instructions, setInstructions] = useState("");
  const [priceText, setPriceText] = useState("");
  const [error, setError] = useState("");
  // "Keep as typed" is remembered for that exact text only.
  const [keptAsTyped, setKeptAsTyped] = useState("");
  const suggestions = useMemo(() => suggestionsFor(dish, dishNames), [dish, dishNames]);

  // A picked person who has since left the order falls back to Me instead of failing on Add.
  const current: Recipient = recipient.kind === "PERSON" && !people.some((p) => p.id === recipient.id) ? { kind: "ME" } : recipient;
  const isNew = current.kind === "NEW_PERSON" || current.kind === "NEW_GROUP";
  const parsedPrice = parsePeso(priceText);
  const split = useMemo(() => splitDishName(dish, entries, dishNames), [dish, entries, dishNames]);
  const offerSplit = split && keptAsTyped !== dish ? split : null;
  const sizeSuggestions = useMemo(() => variantSuggestions(dish, entries), [dish, entries]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dish.trim()) {
      setError("Type a dish first.");
      dishRef.current?.focus();
      return;
    }
    const who = attributionOf(current, typed);
    if (!who) {
      setOpen(true);
      setError(current.kind === "NEW_GROUP" ? "Name the group, or pick someone." : "Type the person's name, or pick someone.");
      return;
    }
    if (!parsedPrice.ok) {
      setField("price");
      setError(`Price: ${parsedPrice.message}`);
      requestAnimationFrame(() => document.getElementById(`${id}-price`)?.focus());
      return;
    }
    onAdd({ dishName: dish, quantity, variant: variant || null, instructions: instructions || null, attribution: who, unitPriceCentavos: parsedPrice.centavos });
    track({ name: "dish_added", props: { recipient: current.kind.toLowerCase(), quantity, has_notes: Boolean(variant || instructions) } });
    // A name typed once is a chip from now on: keep pointing at it instead of the empty "new" field.
    if (current.kind === "NEW_GROUP") setRecipient({ kind: "GROUP", label: typed.trim() });
    if (current.kind === "NEW_PERSON") setRecipient({ kind: "NAMED", name: typed.trim() });
    if (isNew) setTyped("");
    setDish("");
    setQuantity(1);
    setVariant("");
    setInstructions("");
    setPriceText("");
    setField(null);
    setError("");
    // Close the panel after adding: an open panel plus the composer covered most of a small screen (density review).
    setOpen(false);
    dishRef.current?.focus();
  }

  const ForIcon = current.kind === "GROUP" || current.kind === "NEW_GROUP" || current.kind === "TABLE" ? UsersRound : UserRound;

  return (
    <form onSubmit={submit} noValidate className="rounded-[1.4rem] bg-ticket p-2 shadow-ticket ring-[1.5px] ring-rule" aria-label="Add a dish">
      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2" aria-label="Dishes already in this order" data-ph-mask="">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setDish(name);
                dishRef.current?.focus();
              }}
              className="fade-in min-h-11 cursor-pointer rounded-full bg-saffron-wash px-3.5 text-sm font-semibold text-saffron-ink hover:brightness-95"
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {open ? (
        <fieldset id={`${id}-panel`} className="ease-in-panel relative mb-2 max-h-[45dvh] space-y-2 overflow-y-auto overscroll-contain rounded-2xl bg-paper p-3">
          <legend className="sr-only">Who it&rsquo;s for</legend>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              dishRef.current?.focus();
            }}
            aria-label="Close details"
            className="absolute top-1 right-1 inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-ink-soft hover:bg-ink/6 hover:text-ink"
          >
            <X className="size-5" aria-hidden />
          </button>
          <RecipientPicker
            id={id}
            label="Who’s it for?"
            value={current}
            onChange={(r) => {
              setRecipient(r);
              setError("");
            }}
            typed={typed}
            onTyped={setTyped}
            people={people}
            names={names}
            groups={groups}
          />
        </fieldset>
      ) : null}

      <div data-tour="dish" className="rounded-xl bg-paper px-3 pt-1.5 pb-0.5 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-ink">
        <label htmlFor={`${id}-dish`} className="block text-xs font-semibold text-ink-soft">
          Dish
        </label>
        <input
          ref={dishRef}
          id={`${id}-dish`}
          value={dish}
          onChange={(e) => {
            setDish(e.target.value);
            setError("");
          }}
          maxLength={60}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="e.g. Chicken Katsu"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-9 w-full bg-transparent text-lg outline-none placeholder:text-ink-soft/70"
        />
      </div>

      <p role="status" className="sr-only">
        {offerSplit ? `Split into ${offerSplit.dish}${offerSplit.variant ? `, size ${offerSplit.variant}` : ""}${offerSplit.note ? `, note ${offerSplit.note}` : ""}? Split or keep as typed.` : ""}
      </p>
      {offerSplit ? (
        <div className="mt-1.5 rounded-xl bg-saffron-wash px-3 py-2 text-saffron-ink" data-ph-mask="">
          <p className="text-sm">
            Split into {offerSplit.dish}
            {offerSplit.variant ? ` · size “${offerSplit.variant}”` : ""}
            {offerSplit.note ? ` · note “${offerSplit.note}”` : ""}?
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setDish(offerSplit.dish);
                if (offerSplit.variant) setVariant(offerSplit.variant);
                if (offerSplit.note) setInstructions(offerSplit.note);
                dishRef.current?.focus();
              }}
              className="min-h-11 cursor-pointer rounded-full bg-ink px-4 text-sm font-semibold text-paper"
            >
              Split
            </button>
            <button type="button" onClick={() => {
                setKeptAsTyped(dish);
                dishRef.current?.focus();
              }} className="min-h-11 cursor-pointer rounded-full px-3 text-sm font-semibold hover:bg-ink/8">
              Keep as typed
            </button>
          </div>
        </div>
      ) : null}

      <DetailFields
        id={id}
        open={field}
        onOpen={setField}
        variant={variant}
        onVariant={setVariant}
        instructions={instructions}
        onInstructions={setInstructions}
        suggestions={sizeSuggestions}
        price={{
          text: priceText,
          onChange: (text) => {
            setPriceText(text);
            if (error.startsWith("Price:")) setError("");
          },
          parsed: parsedPrice,
          quantity,
        }}
      />

      {/* Under 360 px "For …" takes its own row so every label stays visible (no icon-only Add). */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => {
            if (!open) track({ name: "recipient_panel_opened" });
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-controls={open ? `${id}-panel` : undefined}
          data-tour="for"
          className={cn("inline-flex min-h-11 min-w-0 flex-1 cursor-pointer max-[359px]:basis-full items-center gap-1.5 rounded-full px-3 text-left hover:bg-ink/6", open && "bg-ink/8")}
        >
          <ForIcon className="size-4 shrink-0 text-ink-soft" aria-hidden />
          <span className="shrink-0 text-sm text-ink-soft">For</span>
          <span className="truncate font-semibold" data-ph-mask="">{summary(current, typed)}</span>
          <ChevronDown className={cn("size-4 shrink-0 text-ink-soft transition-transform duration-200", open && "rotate-180")} aria-hidden />
          <span className="sr-only">. Change who it&rsquo;s for</span>
        </button>
        <Stepper value={quantity} label="this dish" onChange={setQuantity} />
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full bg-tomato font-semibold text-on-tomato transition-[background-color,transform] duration-100 ease-out hover:bg-tomato/90 active:scale-[0.97] disabled:opacity-45 max-[359px]:ml-auto pr-4 pl-3"
        >
          <Plus className="size-5" aria-hidden />
          <span>Add</span>
        </button>
      </div>
      <p id={`${id}-error`} role="alert" className={cn("px-3 text-sm text-bad", error ? "pt-1.5 pb-0.5" : "sr-only")}>
        {error}
      </p>
    </form>
  );
}
