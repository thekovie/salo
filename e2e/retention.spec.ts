import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";
import { openDb } from "@/server/db/client";
import { deleteExpiredSessions } from "@/server/maintenance/cleanup";
import { addDish, inviteCode, startOrder } from "./support/helpers";

test("expiration and deletion: an expired order and its invite stop working (scenario 14)", async ({ page, request }) => {
  await startOrder(page);
  await addDish(page, "Gyoza", 2);
  const code = await inviteCode(page);
  const sessionId = page.url().split("/s/")[1];

  const db = openDb(process.env.DATABASE_URL ?? "postgres://salo@localhost:5433/salo", 1);
  try {
    // Fast-forward: this order's deletion date has passed (closed + 7 days, or 30 quiet days).
    await db.execute(sql`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = ${sessionId}`);
    expect(await deleteExpiredSessions(db)).toBeGreaterThanOrEqual(1);
  } finally {
    await db.$client.end();
  }

  await page.reload();
  await expect(page.getByText("Wala dito.")).toBeVisible();
  expect((await request.get(`/i/${code}`)).status()).toBe(404);
  expect((await request.get(`/api/sessions/${sessionId}/sync`)).status()).toBe(404);
  // The landing page no longer offers to resume it.
  await page.goto("/");
  await expect(page.getByText("Pick up where you left off")).toHaveCount(0);
});
