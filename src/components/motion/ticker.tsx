"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A number that ticks: when it changes, the new value slides in from the direction it moved (up or down) for 160 ms.
 * Reduced motion: the number simply changes.
 */
export function Ticker({ value, className, prefix = "" }: { value: number; className?: string; prefix?: string }) {
  const [last, setLast] = useState(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  if (value !== last) {
    // Derived from the previous render's value (React's documented pattern for "state from previous props").
    setDir(value > last ? "up" : "down");
    setLast(value);
  }
  return (
    <span className={cn("inline-block overflow-hidden align-bottom", className)}>
      <span key={value} data-dir={dir ?? undefined} className={cn("inline-block", dir && "tick")}>
        {prefix}
        {value}
      </span>
    </span>
  );
}
