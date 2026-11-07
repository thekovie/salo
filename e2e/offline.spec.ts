import { expect, test, type Page } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const r = await fetch(path, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
      return r.json();
    },
    { path, method, body },
  );
}

test("going offline shows a clear pill with what's waiting; coming back says so", async ({ page, context }) => {
  await startOrder(page);
  await context.setOffline(true);
  const pill = page.locator("[data-connection]");
  await expect(pill).toHaveAttribute("data-connection", "offline");
  await expect(pill).toContainText("You’re offline. Changes are kept on this phone");
  await addDish(page, "Gyoza", 2);
  await expect(pill).toContainText("1 change waiting");
  await context.setOffline(false);
  await expect(pill).toHaveAttribute("data-connection", "back", { timeout: 15_000 });
  await expect(page.getByTestId("dish-row").filter({ hasText: "Gyoza" })).toBeVisible();
  await expect(page.locator('[data-sync="saved"]')).toBeVisible({ timeout: 15_000 });
});

test("unsent changes survive a reload and are sent once (finding 3)", async ({ page }) => {
  await startOrder(page);
  // Adds can't reach the server: the change waits, and is kept on the phone.
  await page.route("**/api/sessions/*/entries", (route) => route.abort("internetdisconnected"));
  await addDish(page, "Sisig");
  await expect(page.locator('[data-sync="unsynced"]')).toBeVisible();
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("salo:queue:")).map((k) => localStorage.getItem(k)));
  expect(stored.join("")).toContain("Sisig");

  await page.reload();
  await expect(page.getByTestId("dish-row").filter({ hasText: "Sisig" })).toBeVisible();
  await page.unroute("**/api/sessions/*/entries");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator('[data-sync="saved"]')).toBeVisible({ timeout: 20_000 });
  const id = new URL(page.url()).pathname.split("/").pop();
  const snap = await api(page, `/api/sessions/${id}/sync`);
  expect(snap.data.entries.filter((e: { dishName: string }) => e.dishName === "Sisig")).toHaveLength(1);
});

test("a dish added offline in round 1 doesn't slip into round 2; the guest chooses (finding 1)", async ({ page, browser }) => {
  await startOrder(page);
  await addDish(page, "Chicken Katsu");
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await guest.context.setOffline(true);
  await addDish(guest.page, "Halo-halo");

  // Meanwhile the host confirms round 1 and starts round 2.
  const id = new URL(page.url()).pathname.split("/").pop();
  const snap = (await api(page, `/api/sessions/${id}/sync`)).data;
  await api(page, `/api/sessions/${id}/rounds/${snap.activeRoundId}/confirm`, "POST", { expectedRevision: snap.session.revision });
  await api(page, `/api/sessions/${id}/rounds`, "POST");

  await guest.context.setOffline(false);
  await guest.page.evaluate(() => window.dispatchEvent(new Event("online")));
  const alert = guest.page.getByRole("alert").filter({ hasText: "Round 1 was confirmed with the waiter before this dish was saved" });
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await alert.getByRole("button", { name: "Add to round 2" }).click();
  await expect(guest.page.getByTestId("dish-row").filter({ hasText: "Halo-halo" })).toBeVisible({ timeout: 15_000 });
  await expect(guest.page.locator('[data-sync="saved"]')).toBeVisible({ timeout: 15_000 });
  const after = (await api(page, `/api/sessions/${id}/sync`)).data;
  const halo = after.entries.find((e: { dishName: string }) => e.dishName === "Halo-halo");
  expect(halo.roundId).toBe(after.activeRoundId);
  await guest.context.close();
});
