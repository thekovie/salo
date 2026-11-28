import { MarkShapes } from "@/components/brand/mark";
import { cn } from "@/lib/utils";

/** The Salo mark: a round table seen from above, four plates and a serving dish. One table, everyone's order. */
export function LogoMark({ className, title, inverse = false, rim = true }: { className?: string; title?: string; inverse?: boolean; rim?: boolean }) {
  const table = inverse ? "var(--on-band)" : "var(--tomato)";
  const plate = inverse ? "var(--band)" : "var(--on-tomato)";
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <MarkShapes table={table} plate={plate} rim={rim} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* Rims fall below a device pixel at 1.6em on 1x screens, so the wordmark draws plain plates like the favicon. */}
      <LogoMark className="size-[1.6em]" rim={false} />
      <span className="font-display text-[1.35em] leading-none font-medium tracking-tight">salo</span>
    </span>
  );
}
