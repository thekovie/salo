import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3.5 text-base text-ink placeholder:text-ink-soft aria-invalid:border-bad disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
