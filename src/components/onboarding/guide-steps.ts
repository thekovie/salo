import type { SessionSnapshot } from "@/lib/snapshot";

/** Which picture a step shows (see guide-scenes.tsx and landing/scenes.tsx). */
export type GuideScene = "setup" | "invite" | "add" | "forPrice" | "people" | "waiter" | "rounds" | "kkb" | "done";

/** What "Try it" does: closes the guide and takes the person to that feature. */
export type GuideAction = "invite" | "dish" | "details" | "people" | "review" | "rounds" | "kkb" | "ready" | "ticket";

export interface GuideStep {
  id: string;
  title: string;
  body: string;
  scene: GuideScene;
  action: GuideAction | null;
  /** Short checklist label. */
  label: string;
  /** Already done in this order (shown as ✓ on the step and in the final checklist). null = nothing to tick. */
  done: ((s: SessionSnapshot) => boolean) | null;
}

const mine = (s: SessionSnapshot) => s.entries.filter((e) => e.submittedBy === s.me.participantId);
const anyPrice = (s: SessionSnapshot) => Object.values(s.settlement.entries).some((p) => p.unitCentavos != null);
const anyConfirmed = (s: SessionSnapshot) => s.rounds.some((r) => r.status === "CONFIRMED");

export const HOST_GUIDE: readonly GuideStep[] = [
  {
    id: "setup",
    title: "Set up your table",
    body: "Your name tells everyone which dishes are yours. The order name shows on the invite, like the restaurant or the occasion. Both are optional and you can change them later in Options.",
    scene: "setup",
    action: null,
    label: "Name yourself and the order",
    done: (s) => s.me.displayName.trim().toLowerCase() !== "host" && Boolean(s.session.title),
  },
  {
    id: "invite",
    title: "Invite the table",
    body: "Show the QR code or read out the 6-letter code. Friends join from their own phones, no app or sign-up, and add their own dishes.",
    scene: "invite",
    action: "invite",
    label: "Invite the table",
    done: (s) => s.participants.length > 1,
  },
  {
    id: "add",
    title: "Type what people call out",
    body: "One dish, tap Add. The same dish merges into one count; sizes and notes keep their own lines. Undo is on every change.",
    scene: "add",
    action: "dish",
    label: "Add a dish",
    done: (s) => mine(s).length > 0,
  },
  {
    id: "forPrice",
    title: "Who it’s for, sizes and prices",
    body: "Tap For to put a dish down for a friend, a group, the whole table or anyone. Size, notes or price sits in the same panel; the price is optional and helps with KKB later.",
    scene: "forPrice",
    action: "details",
    label: "Add a price",
    done: anyPrice,
  },
  {
    id: "people",
    title: "See it by person and group",
    body: "People shows each person’s dishes and who is still choosing. Groups shows shared orders and their members. Guests can claim dishes you added for them.",
    scene: "people",
    action: "people",
    label: "Check People",
    done: null,
  },
  {
    id: "review",
    title: "Check it, then show the waiter",
    body: "Review spots double orders and unsaved changes, opens a big ticket for the waiter, and marks the round confirmed. Only you can confirm.",
    scene: "waiter",
    action: "review",
    label: "Confirm a round",
    done: anyConfirmed,
  },
  {
    id: "rounds",
    title: "Add-ons and fixes",
    body: "Ordering more later? Start another round; only the new dishes go to the waiter. Something wrong in a confirmed round? Correct a dish from Rounds and it’s listed apart.",
    scene: "rounds",
    action: "rounds",
    label: "Know about rounds",
    done: (s) => s.rounds.length > 1 || s.corrections.length > 0,
  },
  {
    id: "kkb",
    title: "Settle up with KKB",
    body: "In Who ordered what → KKB, type prices from the receipt and the service charge. Everyone sees their own food subtotal and share. Shared dishes stay apart until you pick who pays.",
    scene: "kkb",
    action: "kkb",
    label: "Settle up with KKB",
    done: (s) => s.settlement.serviceCharge.centavos != null,
  },
  {
    id: "done",
    title: "You’re all set",
    body: "End the order from Options when everyone’s done: tickets and KKB stay readable for 7 days. Open this guide again any time from Options → How Salo works.",
    scene: "done",
    action: null,
    label: "",
    done: null,
  },
];

export const GUEST_GUIDE: readonly GuideStep[] = [
  {
    id: "add",
    title: "Add your dishes",
    body: "Type a dish and tap Add. Everyone sees it right away, and only you can change the dishes you add.",
    scene: "add",
    action: "dish",
    label: "Add a dish",
    done: (s) => mine(s).length > 0,
  },
  {
    id: "forPrice",
    title: "For someone? Know the price?",
    body: "Tap For to put a dish down for a friend, a group or the whole table. Size, notes or price sits in the same panel; the price is optional and helps with KKB.",
    scene: "forPrice",
    action: "details",
    label: "Add a price",
    done: (s) => mine(s).some((e) => s.settlement.entries[e.id]?.unitCentavos != null),
  },
  {
    id: "ready",
    title: "Tell the host you’re done",
    body: "Tap I’m ready when you’ve chosen. The host sees who is still deciding. Changing your dishes afterwards sets it back.",
    scene: "people",
    action: "ready",
    label: "Mark yourself ready",
    done: (s) => s.readiness.some((r) => r.participantId === s.me.participantId && r.ready),
  },
  {
    id: "ticket",
    title: "See what goes to the waiter",
    body: "The ticket shows the whole table’s order counted up, exactly as the host will read it. In People, tap That’s mine on a dish the host added for you.",
    scene: "waiter",
    action: "ticket",
    label: "See the ticket",
    done: null,
  },
  {
    id: "kkb",
    title: "Your share with KKB",
    body: "People → Who ordered what → KKB shows your food subtotal and, once the host enters it, your share of the service charge. You can price the dishes you added.",
    scene: "kkb",
    action: "kkb",
    label: "Find your KKB share",
    done: null,
  },
  {
    id: "done",
    title: "You’re all set",
    body: "Open this guide again any time with the Help button at the top.",
    scene: "done",
    action: null,
    label: "",
    done: null,
  },
];

export function guideFor(role: "HOST" | "GUEST"): readonly GuideStep[] {
  return role === "HOST" ? HOST_GUIDE : GUEST_GUIDE;
}

const key = (role: "HOST" | "GUEST") => `salo:tour:${role.toLowerCase()}:v1`;
const EVENT = "salo-tour-seen";

/** Whether this browser already took or dismissed the guide for this role. Storage blocked: treat as seen (no nagging). */
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
