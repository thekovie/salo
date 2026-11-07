import type { AddInput } from "@/hooks/use-session";
import type { SnapshotEntry } from "./snapshot";

/** Who the next dish is for. Picked from the order itself, so nobody types a name twice. */
export type Recipient =
  | { kind: "ME" }
  | { kind: "PERSON"; id: string; name: string }
  | { kind: "NAMED"; name: string }
  | { kind: "GROUP"; label: string }
  | { kind: "TABLE" }
  | { kind: "ANYONE" }
  | { kind: "NEW_PERSON" }
  | { kind: "NEW_GROUP" };

export const same = (a: Recipient, b: Recipient) => JSON.stringify(a) === JSON.stringify(b);

export function summary(r: Recipient, typed: string): string {
  switch (r.kind) {
    case "ME":
      return "Me";
    case "PERSON":
    case "NAMED":
      return r.name;
    case "GROUP":
      return r.label;
    case "TABLE":
      return "Whole table";
    case "ANYONE":
      return "Anyone";
    case "NEW_PERSON":
      return typed.trim() || "Someone else";
    case "NEW_GROUP":
      return typed.trim() || "New group";
  }
}

export function attributionOf(r: Recipient, typed: string): AddInput["attribution"] | null {
  switch (r.kind) {
    case "ME":
      return { type: "INDIVIDUAL" };
    case "PERSON":
      return { type: "INDIVIDUAL", participantId: r.id };
    case "NAMED":
      return { type: "INDIVIDUAL", label: r.name };
    case "GROUP":
      return { type: "GROUP", label: r.label };
    case "TABLE":
      return { type: "TABLE" };
    case "ANYONE":
      return { type: "UNASSIGNED" };
    case "NEW_PERSON":
    case "NEW_GROUP": {
      const label = typed.trim();
      if (!label) return null;
      return r.kind === "NEW_GROUP" ? { type: "GROUP", label } : { type: "INDIVIDUAL", label };
    }
  }
}


/** The chips offered for "who's it for": me, people in the order, names typed earlier, groups, then the rest. */
export function recipientChips(people: { id: string; displayName: string }[], names: string[], groups: string[]): { r: Recipient; label: string; group?: boolean }[] {
  return [
    { r: { kind: "ME" }, label: "Me" },
    ...people.map((p): { r: Recipient; label: string } => ({ r: { kind: "PERSON", id: p.id, name: p.displayName }, label: p.displayName })),
    ...names.map((name): { r: Recipient; label: string } => ({ r: { kind: "NAMED", name }, label: name })),
    ...groups.map((label): { r: Recipient; label: string; group: boolean } => ({ r: { kind: "GROUP", label }, label, group: true })),
    { r: { kind: "TABLE" }, label: "Whole table", group: true },
    { r: { kind: "ANYONE" }, label: "Anyone" },
    { r: { kind: "NEW_PERSON" }, label: "+ Someone else" },
    { r: { kind: "NEW_GROUP" }, label: "+ New group", group: true },
  ];
}

/** Who an existing dish is for, as a picker value (for "Edit dish"). */
export function recipientOf(entry: Pick<SnapshotEntry, "attribution">, meId: string, people: { id: string; displayName: string }[]): Recipient {
  const { type, label, participantId } = entry.attribution;
  if (type === "TABLE") return { kind: "TABLE" };
  if (type === "UNASSIGNED") return { kind: "ANYONE" };
  if (type === "GROUP") return label ? { kind: "GROUP", label } : { kind: "ANYONE" };
  if (participantId === meId) return { kind: "ME" };
  if (participantId) {
    const person = people.find((p) => p.id === participantId);
    return person ? { kind: "PERSON", id: person.id, name: person.displayName } : { kind: "ANYONE" };
  }
  return label ? { kind: "NAMED", name: label } : { kind: "ME" };
}
