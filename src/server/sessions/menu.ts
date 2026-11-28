import { eq } from "drizzle-orm";
import { optionalText } from "@/lib/dish-name";
import { can, type Actor } from "@/lib/permissions";
import type { Tx } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import { limitMenuChanges } from "@/server/limits";
import type { Applied, SessionRow } from "@/server/mutations";
import { LIMITS } from "@/server/orders/validation";

/** Set, change or remove the menu link (host only). `url` is already normalised by the schema; null removes it and its label. */
export async function setMenuLink(tx: Tx, session: SessionRow, actor: Actor, input: { url: string | null; label?: string | null }): Promise<Applied<{ changed: boolean }>> {
  if (!can(actor, "session.menu")) throw forbidden("Only the host can change the menu link.");
  const url = input.url;
  const label = url === null ? null : optionalText(input.label);
  // Length is checked again after tidying: NFKC can expand a few characters into many.
  if (label && label.length > LIMITS.label) throw new AppError(422, "INVALID", `Keep it under ${LIMITS.label} characters.`);
  if (url === session.menuUrl && label === session.menuLabel) return { result: { changed: false }, event: null };
  limitMenuChanges(actor);
  await tx.update(sessions).set({ menuUrl: url, menuLabel: label }).where(eq(sessions.id, session.id));
  return { result: { changed: true }, event: { type: "session.menuSet", payload: {} } };
}
