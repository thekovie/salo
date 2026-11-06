import { cn } from "@/lib/utils";

/** The rubber stamp a confirmed round gets. Decorative: the round's status is always also stated in text. */
export function Stamp({ label = "Confirmed", className, animate = false }: { label?: string; className?: string; animate?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none inline-block rotate-[-8deg] rounded-md border-[3px] border-double border-tomato-ink px-[0.6em] py-[0.15em]",
        "font-mono font-medium tracking-[0.18em] text-tomato-ink uppercase opacity-85 [mix-blend-mode:var(--stamp-blend)]",
        // Lands a beat after the ticket arrives, so the eye is already there.
        animate && "motion-safe:animate-[stamp-in_var(--dur-stamp)_var(--ease-out-expo)_280ms_both]",
        className,
      )}
    >
      {label}
    </span>
  );
}
