export type Role = "HOST" | "GUEST";

export interface Actor {
  participantId: string;
  sessionId: string;
  role: Role;
  displayName: string;
  /** A guest the host lets help mark food served. Only meaningful for guests. */
  cohost?: boolean;
}

export type Action =
  | "entry.add"
  | "entry.editOwn"
  | "entry.editAny"
  | "session.rename"
  | "round.confirm"
  | "round.open"
  | "session.close"
  | "claim.approve"
  | "ready.set"
  | "participant.remove"
  | "price.editAny"
  | "price.default"
  | "dish.unavailable"
  | "billTo.set"
  | "serviceCharge.set"
  | "receipt.set"
  | "adjustment.set"
  | "participant.renameSelf"
  | "serving.update"
  | "cohost.set"
  | "settlement.record"
  | "host.transfer";

const HOST_ONLY: ReadonlySet<Action> = new Set(["entry.editAny", "session.rename", "round.confirm", "round.open", "session.close", "claim.approve", "participant.remove", "price.editAny", "price.default", "dish.unavailable", "billTo.set", "serviceCharge.set", "receipt.set", "adjustment.set", "participant.renameSelf", "serving.update", "cohost.set", "settlement.record", "host.transfer"]);

/** Role × action (brief 4). Roles come from the server-side credential, never from a request body. */
export function can(actor: Pick<Actor, "role" | "cohost">, action: Action): boolean {
  if (action === "serving.update" && actor.cohost) return true;
  return actor.role === "HOST" || !HOST_ONLY.has(action);
}

/** Hosts may change any draft entry; guests only entries they submitted themselves. */
export function canEditEntry(actor: Pick<Actor, "role" | "participantId">, entry: { submittedBy: string }): boolean {
  return can(actor, "entry.editAny") || entry.submittedBy === actor.participantId;
}

/** KKB prices: the host may price any entry; guests the entries they submitted. Unlike edits, confirmed rounds too. */
export function canEditPrice(actor: Pick<Actor, "role" | "participantId">, entry: { submittedBy: string }): boolean {
  return can(actor, "price.editAny") || entry.submittedBy === actor.participantId;
}
