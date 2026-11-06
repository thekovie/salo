export type Role = "HOST" | "GUEST";

export interface Actor {
  participantId: string;
  sessionId: string;
  role: Role;
  displayName: string;
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
  | "ready.set";

const HOST_ONLY: ReadonlySet<Action> = new Set(["entry.editAny", "session.rename", "round.confirm", "round.open", "session.close", "claim.approve"]);

/** Role × action (brief 4). Roles come from the server-side credential, never from a request body. */
export function can(actor: Pick<Actor, "role">, action: Action): boolean {
  return actor.role === "HOST" || !HOST_ONLY.has(action);
}

/** Hosts may change any draft entry; guests only entries they submitted themselves. */
export function canEditEntry(actor: Pick<Actor, "role" | "participantId">, entry: { submittedBy: string }): boolean {
  return can(actor, "entry.editAny") || entry.submittedBy === actor.participantId;
}
