import { cn } from "@/lib/utils";

/**
 * The Salo mark: a round table seen from above, with a speech-bubble tail, and three plates in a row that read as a
 * "typing…" indicator. Everyone's voice, one table.
 */
export function LogoMark({ className, title, inverse = false }: { className?: string; title?: string; inverse?: boolean }) {
  const table = inverse ? "var(--on-tomato)" : "var(--tomato)";
  const plate = inverse ? "var(--tomato)" : "var(--on-tomato)";
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <circle cx="25" cy="23" r="20" fill={table} />
      <path d="M6.5 44.5 9.6 31.5 18.2 38.6Z" fill={table} />
      {[14.5, 25, 35.5].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="23" r="4.6" fill={plate} />
          <circle cx={cx} cy="23" r="2.7" fill="none" stroke={table} strokeOpacity="0.35" strokeWidth="0.9" />
        </g>
      ))}
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-[1.6em]" />
      <span className="font-display text-[1.35em] leading-none font-medium tracking-tight">salo</span>
    </span>
  );
}
