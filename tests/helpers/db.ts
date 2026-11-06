import { sql } from "drizzle-orm";
import { openDb, type Db } from "@/server/db/client";

/** The integration database: created and migrated once by tests/global-setup.ts. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://salo:salo@localhost:5433/salo_test";

let shared: Db | undefined;
export function testDb(): Db {
  return (shared ??= openDb(TEST_DATABASE_URL, 5));
}

/** Every table hangs off sessions with ON DELETE CASCADE, so truncating it empties the database. */
export async function resetDb(db: Db = testDb()): Promise<void> {
  await db.execute(sql`TRUNCATE sessions CASCADE`);
}
