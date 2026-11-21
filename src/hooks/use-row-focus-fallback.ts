import { useLayoutEffect, useRef, type FocusEvent } from "react";
import { focusFirst, focusIsLost } from "@/lib/focus";

/**
 * When the focused control's row is removed (stepper Remove, or a live update from another phone), focus goes to
 * the same control in the next row, else the previous row, else `lastResort` (a selector for the empty-state action).
 * Spread the result on the list's container.
 */
export function useRowFocusFallback<T extends HTMLElement>(rowSelector: string, lastResort: string) {
  const root = useRef<T>(null);
  const last = useRef<{ el: HTMLElement; row: number; control: number } | null>(null);
  useLayoutEffect(() => {
    const seen = last.current;
    if (!seen || seen.el.isConnected || !focusIsLost()) return;
    last.current = null;
    const rows = [...(root.current?.querySelectorAll<HTMLElement>(rowSelector) ?? [])];
    const control = (i: number) => rows[i]?.querySelectorAll("button")[seen.control];
    const anyButton = (i: number) => rows[i]?.querySelector("button:not(:disabled)");
    focusFirst([control(seen.row), anyButton(seen.row), control(seen.row - 1), anyButton(seen.row - 1), document.querySelector(lastResort)]);
  });
  return {
    ref: root,
    onFocus: (event: FocusEvent<T>) => {
      const el = event.target as HTMLElement;
      const row = el.closest<HTMLElement>(rowSelector);
      const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(rowSelector)];
      last.current = row ? { el, row: rows.indexOf(row), control: [...row.querySelectorAll("button")].indexOf(el as HTMLButtonElement) } : null;
    },
    onBlur: (event: FocusEvent<T>) => {
      const el = event.target;
      queueMicrotask(() => {
        if (last.current?.el === el && el.isConnected) last.current = null;
      });
    },
  };
}
