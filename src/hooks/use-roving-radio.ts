"use client";

import { useRef } from "react";

/**
 * WAI-ARIA radio group keyboard behaviour for a row of `role="radio"` buttons: one Tab stop (the checked option, or
 * the first), arrow keys move and select (wrapping), Home and End jump to the ends.
 */
export function useRovingRadio(count: number, checkedIndex: number, select: (index: number) => void) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const active = checkedIndex >= 0 ? checkedIndex : 0;

  function move(to: number) {
    const index = (to + count) % count;
    select(index);
    refs.current[index]?.focus();
  }

  return (index: number) => ({
    ref: (el: HTMLElement | null) => {
      refs.current[index] = el;
    },
    tabIndex: index === active ? 0 : -1,
    onKeyDown: (event: React.KeyboardEvent) => {
      const keys: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: count - 1 };
      if (!(event.key in keys)) return;
      event.preventDefault();
      move(keys[event.key]);
    },
  });
}
