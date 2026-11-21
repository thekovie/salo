/** Connected, enabled and actually on screen: the only elements focus may move to. */
export function canFocus(el: Element | null | undefined): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

/** Focuses the first candidate that passes `canFocus`; false when none does. */
export function focusFirst(candidates: Iterable<Element | null | undefined>): boolean {
  for (const el of candidates) {
    if (canFocus(el)) {
      el.focus();
      if (document.activeElement === el) return true;
    }
  }
  return false;
}

/** Focus fell to the page (an element under it was removed). */
export const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

// A closing drawer, then a live re-render, can drop focus to the page: keep restoring it for `ms` (timer, not rAF),
// stopping the moment the user puts focus anywhere else. A focused candidate keeps it watching: it may unmount.
export function focusWhenFree(candidates: () => Iterable<Element | null | undefined>, ms = 3000): void {
  const deadline = Date.now() + ms;
  const attempt = () => {
    const active = document.activeElement;
    const list = [...candidates()];
    const held = !active || active === document.body || active.closest("[role=dialog], dialog") !== null || list.includes(active);
    if (!held || Date.now() > deadline) return;
    focusFirst(list);
    setTimeout(attempt, 50);
  };
  setTimeout(attempt, 0);
}
