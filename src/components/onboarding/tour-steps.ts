/** One stop on the tour: which element to spotlight (`data-tour="…"`) and what to say about it. */
export interface TourStep {
  target: string;
  title: string;
  body: string;
}

export const HOST_TOUR: readonly TourStep[] = [
  { target: "dish", title: "Type what people call out", body: "One dish, tap Add. Same dishes merge into one count; sizes and notes stay on their own lines." },
  { target: "for", title: "Who’s it for?", body: "It starts on you. Tap to pick a friend, a group, the whole table, or nobody in particular." },
  { target: "invite", title: "Let the table add their own", body: "Show the QR or read out the code. Friends join from their phones, no app or sign-up." },
  { target: "review", title: "Check it, then show the waiter", body: "Review spots double orders and unsaved changes, opens a big ticket for the waiter, and marks the round confirmed." },
  { target: "options", title: "Name, cancel or end", body: "The Options button: rename the order, cancel it, or end it when the table is done. Ending gives you “who ordered what” for settling up." },
];

export const GUEST_TOUR: readonly TourStep[] = [
  { target: "dish", title: "Add your dishes", body: "Type a dish and tap Add. Only you can change the dishes you add." },
  { target: "for", title: "Ordering for someone?", body: "It starts on you. Tap to put a dish down for a friend, a group or the whole table." },
  { target: "ready", title: "Tell the host you’re done", body: "Tap I’m ready when you’ve chosen. The host sees who is still deciding." },
  { target: "ticket", title: "See what goes to the waiter", body: "The ticket shows the whole table’s order, counted up, exactly as the host will read it." },
  { target: "help", title: "Need this again?", body: "Tap here any time for the tour." },
];

const key = (role: "HOST" | "GUEST") => `salo:tour:${role.toLowerCase()}:v1`;
const EVENT = "salo-tour-seen";

/** Whether this browser already took or dismissed the tour for this role. Storage blocked: treat as seen (no nagging). */
export function tourSeen(role: "HOST" | "GUEST"): boolean {
  try {
    return localStorage.getItem(key(role)) !== null;
  } catch {
    return true;
  }
}

export function markTourSeen(role: "HOST" | "GUEST"): void {
  try {
    localStorage.setItem(key(role), "1");
  } catch {
    // Storage blocked: the offer just won't come back this page view.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeTourSeen(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
