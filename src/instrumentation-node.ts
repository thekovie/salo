import { getEnv } from "./env";
import { log } from "./lib/logger";
import { getDb, migrateDb } from "./server/db/client";
import { CLEANUP_INTERVAL_MS, deleteExpiredSessions } from "./server/maintenance/cleanup";

// Fail fast: a bad setting or an unreachable database stops the process with a clear message (exit 1, so the
// container restarts and the log says why) instead of leaving a server that errors on every page.
try {
  getEnv();
  await migrateDb(getDb());
  log.info("salo started", { migrations: "applied" });
} catch (error) {
  log.error("salo could not start", { error });
  process.exit(1);
}

async function cleanup(): Promise<void> {
  try {
    const removed = await deleteExpiredSessions(getDb());
    if (removed > 0) log.info("deleted expired sessions", { removed });
  } catch (error) {
    // The next run tries again; nothing is lost by waiting an hour.
    log.warn("session cleanup failed", { error });
  }
}

void cleanup();
setInterval(() => void cleanup(), CLEANUP_INTERVAL_MS).unref();
