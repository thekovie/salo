"use client";

import { ChevronDown, Plus, UserRound, UsersRound, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AddInput } from "@/hooks/use-session";
import { track } from "@/lib/analytics";
import { normalizeText } from "@/lib/dish-name";
import { splitDishName, variantSuggestions } from "@/lib/dish-details";
import { parsePeso } from "@/lib/money";
import { sharedPriceKey, type SettlementView } from "@/lib/snapshot";
import { attributionOf, summary, type Recipient } from "@/lib/recipient";
import { DetailFields, type DetailField } from "./detail-fields";
import { RecipientPicker } from "./recipient-picker";
import { cn } from "@/lib/utils";
import { Stepper } from "./stepper";

const MAX_SUGGESTIONS = 4;
const isTextField = (el: EventTarget) => el instanceof HTMLElement && el.matches("textarea, input:not([type=radio], [type=checkbox])");
const NARROW = "(max-width: 359px)";
const subscribeNarrow = (notify: () => void) => {
  const query = matchMedia(NARROW);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

interface ComposerProps {
  dishNames: string[];
  /** Other people with a phone in this order (not me, not removed). */
  people: { id: string; displayName: string }[];
  /** Names typed for people without a phone. */
  names: string[];
  /** Group labels already used in this order. */
  groups: string[];
  /** Dishes already in this order, for size suggestions. */
  entries: { dishId: string; dishName: string; variant: string | null }[];
  /** Table prices, so the Price field can say what a blank price will use. */
  defaults: SettlementView["defaults"];
  disabled?: boolean;
  /** Changes when the person switches tab: the "who's it for" panel closes so it doesn't cover the new view. */
  view?: string;
  onAdd: (input: AddInput) => void;
  /** Bumped by the setup guide's "Try it": opens the Price field. */
  detailsSignal?: number;
  /** True while a text field in the composer has focus (the dock hides its bottom bar meanwhile). */
  onActiveChange?: (active: boolean) => void;
}

function suggestionsFor(query: string, names: string[]): string[] {
  const q = normalizeText(query);
  if (!q) return [];
  const starts = names.filter((n) => normalizeText(n).startsWith(q));
  const contains = names.filter((n) => !normalizeText(n).startsWith(q) && normalizeText(n).includes(q));
  return [...starts, ...contains].filter((n) => normalizeText(n) !== q).slice(0, MAX_SUGGESTIONS);
}

/**
 * Quick entry (brief 5.4). At rest (empty, nothing focused) it is the dish and one row of "For" + Add. With a text field
 * focused, or text typed, it also shows the quantity and the size / note / price entry points: chips below on
 * phones from 360 px, behind one "+ Details" chip under that. Everything added sits below the existing rows.
 * After adding: dish, quantity, size and instructions reset; the recipient stays for the next dish.
 */
export function Composer({ dishNames, people, names, groups, entries, defaults, disabled, view, onAdd, detailsSignal = 0, onActiveChange }: ComposerProps) {
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [lastSignal, setLastSignal] = useState(detailsSignal);
  if (detailsSignal !== lastSignal) {
    setLastSignal(detailsSignal);
    setField("price");
    setDetailsOpen(true);
    setActive(true);
  }
  const narrow = useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches, () => false);
  const formRef = useRef<HTMLFormElement>(null);
  // Between a pointer press and its click, focus changes (a tapped button takes focus after the press on touch) must
  // not collapse the composer: the layout would move under the finger and the click would miss.
  const pressing = useRef(false);
  useEffect(() => onActiveChange?.(active), [active, onActiveChange]);
  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);
  useEffect(() => {
    let fallback: ReturnType<typeof setTimeout>;
    const release = () => {
      pressing.current = false;
      clearTimeout(fallback);
    };
    const press = () => {
      pressing.current = true;
      clearTimeout(fallback);
      fallback = setTimeout(release, 1000);
    };
    const outside = (event: Event) => !formRef.current?.contains(event.target as Node);
    const clicked = (event: Event) => {
      release();
      if (outside(event)) setActive(false);
    };
    const focused = (event: Event) => {
      if (!pressing.current && outside(event)) setActive(false);
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("click", clicked, true);
    document.addEventListener("focusin", focused);
    return () => {
      release();
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("click", clicked, true);
      document.removeEventListener("focusin", focused);
    };
  }, []);
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
  const tablePrice = useMemo(() => {
    const known = entries.find((e) => normalizeText(e.dishName) === normalizeText(dish));
    return known ? defaults[sharedPriceKey(known.dishId, normalizeText(variant))]?.unitCentavos : undefined;
  }, [dish, variant, entries, defaults]);
  const detailsCount = [variant, instructions, priceText].filter((v) => v.trim()).length;
  const expanded = active || dish.trim() !== "" || detailsCount > 0 || quantity > 1;
  if (!expanded && field) setField(null);
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
      setDetailsOpen(true);
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
    setDetailsOpen(false);
    setError("");
    // Close the panel after adding: an open panel plus the composer covered most of a small screen (density review).
    setOpen(false);
    dishRef.current?.focus();
  }

  const ForIcon = current.kind === "GROUP" || current.kind === "NEW_GROUP" || current.kind === "TABLE" ? UsersRound : UserRound;

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="rounded-[1.4rem] bg-ticket p-2 shadow-ticket ring-[1.5px] ring-rule"
      aria-label="Add a dish"
      onFocus={(event) => {
        if (isTextField(event.target)) setActive(true);
        else if (!pressing.current) setActive(false);
      }}
      onBlur={(event) => {
        if (!pressing.current && !event.currentTarget.contains(event.relatedTarget)) setActive(false);
      }}
    >
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
          data-focus-fallback=""
          value={dish}
          onChange={(e) => {
            setDish(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
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
          className={cn("inline-flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-full px-3 text-left hover:bg-ink/6", open && "bg-ink/8")}
        >
          <ForIcon className="size-4 shrink-0 text-ink-soft" aria-hidden />
          <span className="shrink-0 text-sm text-ink-soft">For</span>
          <span className="truncate font-semibold" data-ph-mask="">{summary(current, typed)}</span>
          <ChevronDown className={cn("size-4 shrink-0 text-ink-soft transition-transform duration-200", open && "rotate-180")} aria-hidden />
          <span className="sr-only">. Change who it&rsquo;s for</span>
        </button>
        {expanded && !narrow ? <Stepper value={quantity} label="this dish" onChange={setQuantity} /> : null}
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full bg-tomato font-semibold text-on-tomato transition-[background-color,transform] duration-100 ease-out hover:bg-tomato/90 active:scale-[0.97] disabled:opacity-45 pr-4 pl-3"
        >
          <Plus className="size-5" aria-hidden />
          <span>Add</span>
        </button>
        {expanded && narrow ? (
          <div className="flex basis-full items-center justify-between gap-1">
            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-label={detailsCount > 0 ? `Details, ${detailsCount} added` : "Details"}
              onClick={() => setDetailsOpen((v) => !v)}
              className={cn("inline-flex min-h-11 cursor-pointer items-center rounded-full border-[1.5px] border-input px-3.5 text-sm font-semibold text-ink-soft hover:text-ink", detailsOpen && "bg-ink/8 text-ink")}
            >
              {detailsCount > 0 ? `Details · ${detailsCount}` : "+ Details"}
            </button>
            <Stepper value={quantity} label="this dish" onChange={setQuantity} />
          </div>
        ) : null}
      </div>

      {expanded && (!narrow || detailsOpen) ? (
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
            tablePrice,
          }}
        />
      ) : null}
      <p id={`${id}-error`} role="alert" className={cn("px-3 text-sm text-bad", error ? "pt-1.5 pb-0.5" : "sr-only")}>
        {error}
      </p>
    </form>
  );
}
