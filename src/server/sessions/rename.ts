import { eq } from "drizzle-orm";
import { optionalText } from "@/lib/dish-name";
import type { Tx } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { forbidden } from "@/server/errors";
import type { Applied, SessionRow } from "@/server/mutations";
import { can, type Actor } from "@/lib/permissions";

/** Name the table ("Ramen Nagi, Friday"): optional, host only. */
export async function renameSession(tx: Tx, session: SessionRow, actor: Actor, title: string | null | undefined): Promise<Applied<{ title: string | null }>> {
  if (!can(actor, "session.rename")) throw forbidden("Only the host can rename the order.");
  const clean = optionalText(title);
  await tx.update(sessions).set({ title: clean }).where(eq(sessions.id, session.id));
  return { result: { title: clean }, event: { type: "session.renamed", payload: {} } };
}
