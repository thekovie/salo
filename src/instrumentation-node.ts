import { getEnv } from "./env";
import { log } from "./lib/logger";
import { getDb, migrateDb } from "./server/db/client";

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
