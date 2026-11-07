"use client";

import { useCallback, useRef } from "react";

/**
 * Publishes the bottom dock's real height as `--dock-h` on <html>, so the floating stack (toasts, notices) and the
 * page's bottom padding follow it as the composer grows or shrinks, instead of a guessed fixed offset. A callback
 * ref, because the dock comes and goes (review, waiter view, ended order).
 */
export function useDockHeight() {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((el: HTMLDivElement | null) => {
    const root = document.documentElement;
    observer.current?.disconnect();
    observer.current = null;
    if (!el) {
      root.style.removeProperty("--dock-h");
      return;
    }
    const set = () => root.style.setProperty("--dock-h", `${el.offsetHeight}px`);
    set();
    observer.current = new ResizeObserver(set);
    observer.current.observe(el);
  }, []);
}
