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
