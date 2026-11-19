"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { formatPeso, type PesoParse } from "@/lib/money";
import { cn } from "@/lib/utils";

export type DetailField = "variant" | "notes" | "price";

interface PriceProps {
  text: string;
  onChange: (text: string) => void;
  parsed: PesoParse;
  quantity: number;
}

interface DetailFieldsProps {
  id: string;
  open: DetailField | null;
  onOpen: (field: DetailField | null) => void;
  variant: string;
  onVariant: (value: string) => void;
  instructions: string;
  onInstructions: (value: string) => void;
  /** Sizes already used for this dish in this order. */
  suggestions?: string[];
  /** Left out where prices aren't edited (the edit sheet). */
  price?: PriceProps;
}

const INPUT = "mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base";
/** Whole pesos drop ".00" so a long price tag still fits one line at 320 px. */
const shortPeso = (centavos: number) => formatPeso(centavos).replace(/\.00$/, "");

const CHIP = "inline-flex min-h-11 cursor-pointer items-center rounded-full px-3.5 text-sm font-semibold";

/**
 * Size, note and price as one row of chips under the dish (M1a). A chip opens only its own field, one at a time; a
 * filled field collapses into a tag that reopens on tap and clears with its ✕. Shared by the composer and edit sheet.
 */
export function DetailFields({ id, open, onOpen, variant, onVariant, instructions, onInstructions, suggestions = [], price }: DetailFieldsProps) {
  useEffect(() => {
    if (open) document.getElementById(`${id}-${open}`)?.focus();
  }, [id, open]);

  const priceTag = price && price.parsed.ok && price.parsed.centavos != null ? price.parsed.centavos : null;
  const items: { field: DetailField; chip: string; kind: string; tag: string | null; clear: () => void }[] = [
    { field: "variant", chip: "Size", kind: "size", tag: variant.trim() || null, clear: () => onVariant("") },
    { field: "notes", chip: "Note", kind: "note", tag: instructions.trim() || null, clear: () => onInstructions("") },
    ...(price
      ? [{ field: "price" as const, chip: "₱ Price", kind: "price", tag: priceTag == null ? null : `${shortPeso(priceTag)}${price.quantity > 1 ? ` × ${price.quantity} = ${shortPeso(priceTag * price.quantity)}` : ""}`, clear: () => price.onChange("") }]
      : []),
  ];

  return (
    <div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" data-ph-mask="">
        {items.map(({ field, chip, kind, tag, clear }) => {
          const asTag = tag != null && open !== field;
          // One button element in both states, so focus survives a tag turning back into a chip and vice versa.
          return (
            <span key={field} className={cn("inline-flex items-center rounded-full", asTag && "bg-ink/8 text-ink")}>
              <button
                id={`${id}-${field}-chip`}
                type="button"
                aria-expanded={asTag ? undefined : open === field}
                aria-label={asTag ? `${tag}, ${kind}. Edit` : undefined}
                onClick={() => onOpen(open === field ? null : field)}
                className={cn(
                  CHIP,
                  asTag
                    ? cn("rounded-r-none pr-1.5", field === "price" && "tally font-medium")
                    : cn("border-[1.5px] border-input text-ink-soft hover:text-ink", open === field && "bg-ink/8 text-ink"),
                )}
              >
                {asTag ? (
                  tag
                ) : open === field ? (
                  <>
                    {chip}
                    <X className="ml-1 size-4" aria-hidden />
                  </>
                ) : (
                  `+ ${chip}`
                )}
              </button>
              {asTag ? (
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    onOpen(null);
                    requestAnimationFrame(() => document.getElementById(`${id}-${field}-chip`)?.focus());
                  }}
                  aria-label={`Remove ${kind} ${tag}`}
                  className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-ink/8"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </span>
          );
        })}
      </div>

      {open === "variant" ? (
        <div className="ease-in-panel mt-2">
          <label htmlFor={`${id}-variant`} className="text-sm font-semibold">
            Size or variant
          </label>
          <input id={`${id}-variant`} value={variant} onChange={(e) => onVariant(e.target.value)} maxLength={40} placeholder="Large, spicy…" className={INPUT} />
          {suggestions.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Sizes used in this order">
              <span className="text-sm text-ink-soft">used in this order:</span>
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => onVariant(s)} className={cn(CHIP, "bg-saffron-wash text-saffron-ink hover:brightness-95")}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {open === "notes" ? (
        <div className="ease-in-panel mt-2">
          <label htmlFor={`${id}-notes`} className="text-sm font-semibold">
            Instructions
          </label>
          <input id={`${id}-notes`} value={instructions} onChange={(e) => onInstructions(e.target.value)} maxLength={140} placeholder="No sauce, less ice…" className={INPUT} />
        </div>
      ) : null}

      {open === "price" && price ? (
        <div className="ease-in-panel mt-2">
          <label htmlFor={`${id}-price`} className="text-sm font-semibold">
            Price each (₱)
          </label>
          <input
            id={`${id}-price`}
            value={price.text}
            onChange={(e) => price.onChange(e.target.value)}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="Optional"
            aria-invalid={!price.parsed.ok || undefined}
            aria-describedby={`${id}-price-line`}
            className={cn(INPUT, "tally aria-invalid:border-bad")}
          />
          <p id={`${id}-price-line`} aria-live="polite" className="mt-1 min-h-5 text-sm text-ink-soft">
            {price.parsed.ok && price.parsed.centavos != null && price.quantity > 1 ? (
              <span className="tally">
                {formatPeso(price.parsed.centavos)} × {price.quantity} = {formatPeso(price.parsed.centavos * price.quantity)}
              </span>
            ) : !price.parsed.ok ? (
              <span className="text-bad">{price.parsed.message}</span>
            ) : (
              "For KKB later. Leave blank if you don't know."
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
