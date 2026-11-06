"use client";

import { Plus, SlidersHorizontal, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import type { AddInput } from "@/hooks/use-session";
import { normalizeText } from "@/lib/dish-name";
import { cn } from "@/lib/utils";
import { Stepper } from "./stepper";

type ForKind = "ME" | "UNASSIGNED" | "TABLE" | "INDIVIDUAL" | "GROUP";

/** At most four choices per person: guests order for themselves first, the host for whoever is speaking. */
const HOST_OPTIONS: { kind: ForKind; label: string }[] = [
  { kind: "UNASSIGNED", label: "Anyone" },
  { kind: "TABLE", label: "Whole table" },
  { kind: "INDIVIDUAL", label: "A person" },
  { kind: "GROUP", label: "A group" },
];
const GUEST_OPTIONS: { kind: ForKind; label: string }[] = [
  { kind: "ME", label: "Me" },
  { kind: "TABLE", label: "Whole table" },
  { kind: "INDIVIDUAL", label: "Someone else" },
  { kind: "GROUP", label: "A group" },
];

const MAX_SUGGESTIONS = 4;

interface ComposerProps {
  dishNames: string[];
  /** Names already used for people and groups, offered as suggestions. */
  knownLabels: string[];
  disabled?: boolean;
  /** Guests usually order for themselves; the host usually for whoever is speaking. */
  defaultFor?: ForKind;
  onAdd: (input: AddInput) => void;
}

function suggestionsFor(query: string, names: string[]): string[] {
  const q = normalizeText(query);
  if (!q) return [];
  const starts = names.filter((n) => normalizeText(n).startsWith(q));
  const contains = names.filter((n) => !normalizeText(n).startsWith(q) && normalizeText(n).includes(q));
  return [...starts, ...contains].filter((n) => normalizeText(n) !== q).slice(0, MAX_SUGGESTIONS);
}

/**
 * Quick entry (brief 5.4): dish, quantity, Add. Who it's for, size and instructions hide behind "Details".
 * After adding: dish, quantity, size and instructions reset; the recipient stays for the next dish.
 */
export type { ForKind };

export function Composer({ dishNames, knownLabels, disabled, defaultFor = "UNASSIGNED", onAdd }: ComposerProps) {
  const id = useId();
  const dishRef = useRef<HTMLInputElement>(null);
  const [dish, setDish] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [open, setOpen] = useState(false);
  const [forKind, setForKind] = useState<ForKind>(defaultFor);
  const [forLabel, setForLabel] = useState("");
  const [variant, setVariant] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const suggestions = useMemo(() => suggestionsFor(dish, dishNames), [dish, dishNames]);

  function attribution(): AddInput["attribution"] | null {
    if (forKind === "ME") return { type: "INDIVIDUAL" };
    if (forKind === "UNASSIGNED" || forKind === "TABLE") return { type: forKind };
    const label = forLabel.trim();
    if (!label) return null;
    return forKind === "GROUP" ? { type: "GROUP", label } : { type: "INDIVIDUAL", label };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dish.trim()) {
      setError("Type a dish first.");
      dishRef.current?.focus();
      return;
    }
    const who = attribution();
    if (!who) {
      setOpen(true);
      setError(forKind === "GROUP" ? "Name the group, or choose Anyone." : "Type the person's name, or choose Anyone.");
      return;
    }
    onAdd({ dishName: dish, quantity, variant: variant || null, instructions: instructions || null, attribution: who });
    setDish("");
    setQuantity(1);
    setVariant("");
    setInstructions("");
    setError("");
    dishRef.current?.focus();
  }

  const recipientSummary = forKind === "UNASSIGNED" || forKind === "ME" ? null : forKind === "TABLE" ? "Whole table" : forLabel.trim() || null;

  return (
    <form onSubmit={submit} noValidate className="rounded-[1.4rem] bg-ticket p-2 shadow-ticket ring-[1.5px] ring-rule" aria-label="Add a dish">
      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2" aria-label="Dishes already in this order">
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
        <fieldset className="ease-in-panel relative mb-2 space-y-3 rounded-2xl bg-paper p-3">
          <legend className="sr-only">Details</legend>
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
          <div className="pr-10">
            <span className="text-sm font-semibold" id={`${id}-for`}>
              Ordered for
            </span>
            <div role="radiogroup" aria-labelledby={`${id}-for`} className="mt-1.5 flex flex-wrap gap-1.5">
              {(defaultFor === "ME" ? GUEST_OPTIONS : HOST_OPTIONS).map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  role="radio"
                  aria-checked={forKind === option.kind}
                  onClick={() => setForKind(option.kind)}
                  className={cn(
                    "min-h-11 cursor-pointer rounded-full border-[1.5px] px-3.5 text-sm font-semibold transition-colors",
                    forKind === option.kind ? "border-ink bg-ink text-paper" : "border-input bg-ticket text-ink hover:bg-paper",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {forKind === "INDIVIDUAL" || forKind === "GROUP" ? (
              <>
                <label htmlFor={`${id}-label`} className="sr-only">
                  {forKind === "GROUP" ? "Group name" : "Person's name"}
                </label>
                <input
                  id={`${id}-label`}
                  list={`${id}-labels`}
                  value={forLabel}
                  onChange={(e) => setForLabel(e.target.value)}
                  maxLength={40}
                  placeholder={forKind === "GROUP" ? "Group name, e.g. Miguel's group" : "Name, e.g. Miguel"}
                  className="mt-2 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base"
                />
                <datalist id={`${id}-labels`}>
                  {knownLabels.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
              </>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-variant`} className="text-sm font-semibold">
                Size or variant
              </label>
              <input id={`${id}-variant`} value={variant} onChange={(e) => setVariant(e.target.value)} maxLength={40} placeholder="Large, spicy…" className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base" />
            </div>
            <div>
              <label htmlFor={`${id}-notes`} className="text-sm font-semibold">
                Instructions
              </label>
              <input id={`${id}-notes`} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={140} placeholder="No sauce, less ice…" className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base" />
            </div>
          </div>
        </fieldset>
      ) : null}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Hide details" : "Details: who it's for, size, instructions"}
          className={cn("relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6", open && "bg-ink/8")}
        >
          <SlidersHorizontal className="size-5" aria-hidden />
          {!open && (recipientSummary || variant || instructions) ? <span className="absolute top-2 right-2 size-2 rounded-full bg-tomato" aria-hidden /> : null}
        </button>
        <label htmlFor={`${id}-dish`} className="sr-only">
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
          placeholder={recipientSummary ? `Dish for ${recipientSummary}` : "Add a dish"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-h-11 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-[1.05rem] placeholder:text-ink-soft focus-visible:outline-offset-0"
        />
        <Stepper value={quantity} label="this dish" onChange={setQuantity} />
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-tomato pr-4 pl-3 font-semibold text-on-tomato transition-[background-color,transform] duration-100 ease-out hover:bg-tomato/90 active:scale-[0.97] disabled:opacity-45"
        >
          <Plus className="size-5" aria-hidden />
          Add
        </button>
      </div>
      <p id={`${id}-error`} role="alert" className={cn("px-3 text-sm text-bad", error ? "pt-1.5 pb-0.5" : "sr-only")}>
        {error}
      </p>
    </form>
  );
}
