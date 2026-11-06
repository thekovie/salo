import { Minus, Plus, Trash2 } from "lucide-react";
import { Ticker } from "@/components/motion/ticker";
import { cn } from "@/lib/utils";

interface StepperProps {
  value: number;
  /** Name of what is being counted, for screen readers ("Gyoza for Miguel"). */
  label: string;
  onChange: (next: number) => void;
  /** Called instead of going below 1. Without it, the minus button stops at 1. */
  onRemove?: () => void;
  max?: number;
  disabled?: boolean;
  size?: "md" | "lg";
}

/** − n + with 44px targets. At 1 the minus becomes a remove button when removal is allowed (brief 6.3). */
export function Stepper({ value, label, onChange, onRemove, max = 99, disabled, size = "md" }: StepperProps) {
  const atMin = value <= 1;
  const btn = "inline-flex size-11 cursor-pointer items-center justify-center rounded-full transition-[background-color,transform] duration-100 ease-out hover:bg-ink/8 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35";
  return (
    <div className="inline-flex items-center" role="group" aria-label={`Quantity of ${label}`}>
      <button
        type="button"
        className={cn(btn, atMin && onRemove && "text-bad")}
        disabled={disabled || (atMin && !onRemove)}
        onClick={() => (atMin ? onRemove?.() : onChange(value - 1))}
        aria-label={atMin && onRemove ? `Remove ${label}` : `One less ${label}`}
      >
        {atMin && onRemove ? <Trash2 className="size-[1.1rem]" aria-hidden /> : <Minus className="size-5" aria-hidden />}
      </button>
      <span className={cn("tally min-w-[2ch] text-center text-tomato-ink", size === "lg" ? "text-3xl" : "text-2xl")} aria-live="polite">
        <Ticker value={value} />
      </span>
      <button type="button" className={btn} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label={`One more ${label}`}>
        <Plus className="size-5" aria-hidden />
      </button>
    </div>
  );
}
