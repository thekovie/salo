import postgres from "postgres";
import { migrateDb, openDb } from "@/server/db/client";
import { TEST_DATABASE_URL } from "./helpers/db";

/** Creates the test database if needed (from the same server) and applies every migration once per run. */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  const admin = postgres({ ...parse(url), database: "postgres", max: 1, onnotice: () => {} });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
  } finally {
    await admin.end();
  }
  const db = openDb(TEST_DATABASE_URL, 1);
  await migrateDb(db);
  await db.$client.end();
}

function parse(url: URL) {
  return { host: url.hostname, port: Number(url.port || 5432), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
}
