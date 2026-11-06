import { cn } from "@/lib/utils";

/** The rubber stamp a confirmed round gets. Decorative: the round's status is always also stated in text. */
export function Stamp({ label = "Confirmed", className }: { label?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none inline-block rotate-[-8deg] rounded-md border-[3px] border-double border-tomato-ink px-3 py-1",
        "font-mono text-lg font-medium tracking-[0.18em] text-tomato-ink uppercase opacity-85 [mix-blend-mode:var(--stamp-blend)]",
        className,
      )}
    >
      {label}
    </span>
  );
}
