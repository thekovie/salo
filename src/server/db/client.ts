import path from "node:path";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getEnv } from "@/env";
import { singleton } from "@/server/singleton";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
/** Small on purpose: one app instance on a 512 MiB container (brief 13.3). */
const POOL_SIZE = 10;

export function openDb(url: string, max = POOL_SIZE): Db {
  const client = postgres(url, { max, idle_timeout: 30, connect_timeout: 10, onnotice: () => {} });
  return drizzle(client, { schema });
}

export async function migrateDb(db: Db, folder = MIGRATIONS_DIR): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}

/** Process-wide pool (survives dev-server reloads). Migrations run once at startup (instrumentation-node.ts). */
export function getDb(): Db {
  return singleton("db", () => openDb(getEnv().DATABASE_URL));
}
