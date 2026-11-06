import { flushSync } from "react-dom";

/**
 * Run a state change inside a View Transition when the browser supports it and the person has not asked for reduced
 * motion: rows that move glide to their new place and removed rows fade. Otherwise it simply runs.
 */
export function withViewTransition(change: () => void): void {
  const doc = typeof document === "undefined" ? null : (document as Document & { startViewTransition?: (cb: () => void) => unknown });
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc?.startViewTransition || reduce) {
    change();
    return;
  }
  doc.startViewTransition(() => flushSync(change));
}

/** A valid view-transition-name for an id (letters, digits, dashes only). */
export const transitionName = (prefix: string, id: string) => `${prefix}-${id.replace(/[^a-zA-Z0-9-]/g, "-")}`;
