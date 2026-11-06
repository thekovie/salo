import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";

export interface Health {
  ok: boolean;
  database: "ok" | "unavailable";
}

/** What the container health check asks. Terse on purpose: the endpoint is public, so it never says why. */
export async function checkHealth(db: Db): Promise<Health> {
  try {
    await db.execute(sql`SELECT 1 FROM sessions LIMIT 1`);
    return { ok: true, database: "ok" };
  } catch {
    return { ok: false, database: "unavailable" };
  }
}
