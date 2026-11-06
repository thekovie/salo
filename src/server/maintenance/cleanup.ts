import { lte, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { sessions } from "@/server/db/schema";

/** How often the in-process cleanup runs. Deletion is at most this late. */
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Retention (brief 12): every session carries its own deletion date — closed + CLOSED_RETENTION_DAYS (set when it is
 * closed), or last activity + INACTIVE_RETENTION_DAYS (moved forward by every change while open). Deleting the session
 * removes everything that belongs to it (all foreign keys cascade). Backups are separate (docs/backups.md).
 */
export async function deleteExpiredSessions(db: Db, now: Date = new Date()): Promise<number> {
  const deleted = await db.delete(sessions).where(lte(sessions.expiresAt, sql`${now.toISOString()}::timestamptz`)).returning({ id: sessions.id });
  return deleted.length;
}
