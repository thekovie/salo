import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, openNotes, orderFor, startOrder } from "./support/helpers";

// Design-review captures of every screen from the current build. Skipped unless CAPTURE=1:
//   CAPTURE=1 pnpm e2e e2e/capture.spec.ts
test.skip(!process.env.CAPTURE, "set CAPTURE=1 to take design-review screenshots");
// A common phone: 390×844 CSS pixels at 3× (iPhone 12–15 class).
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const DIR = ".impeccable/review";
const shot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}.png` });
async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function api(page: Page, path: string, method: string, body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const r = await fetch(path, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
      return r.json();
    },
    { path, method, body },
  );
}

async function confirmCurrent(page: Page, id: string) {
  const snap = (await api(page, `/api/sessions/${id}/sync`, "GET")).data;
  await api(page, `/api/sessions/${id}/rounds/${snap.activeRoundId}/confirm`, "POST", { expectedRevision: snap.session.revision });
}

test("capture every screen", async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/");
  await shot(page, "cap-01-landing-light");

  await startOrder(page);
  const id = page.url().split("/s/")[1];
  await api(page, `/api/sessions/${id}`, "PATCH", { title: "Ramen Nagi" });
  const code = await inviteCode(page);
  const guest = await joinAsGuest(browser, code, "Rafa");
  await guest.page.setViewportSize({ width: 390, height: 844 });
  await guest.page.emulateMedia({ reducedMotion: "reduce" });
  await orderFor(page, "A person", "Miguel");
  await addDish(page, "Chicken Katsu", 2);
  await orderFor(page, "A group", "Miguel's group");
  await addDish(page, "Gyoza", 3);
  await orderFor(page, "Whole table");
  await addDish(page, "Crispy Pata");
  await orderFor(page, "A person", "Rafa");
  await addDish(page, "Halo-halo");
  await page.getByRole("button", { name: "Close details" }).click();
  await openNotes(guest.page);
  await guest.page.getByLabel("Instructions").fill("No sauce");
  await addDish(guest.page, "Chicken Katsu");
  await guest.page.getByRole("button", { name: "Close details" }).click();
  await addDish(guest.page, "Iced Tea", 3);
  await expect(page.getByTestId("dish-row").filter({ hasText: "Iced Tea" })).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await shot(page, "cap-02-workspace-light");
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await shot(page, "cap-03-workspace-dark");
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });

  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await shot(page, "cap-04-invite-sheet");
  await page.keyboard.press("Escape");

  await guest.page.getByRole("tab", { name: /People/ }).click();
  await shot(guest.page, "cap-05-people-guest");
  await page.getByRole("tab", { name: /Groups/ }).click();
  await shot(page, "cap-06-groups-host");
  await page.getByRole("tab", { name: /Order/ }).click();

  await page.getByRole("button", { name: "Review order" }).click();
  await shot(page, "cap-07-review");
  await page.getByRole("button", { name: "Show the waiter" }).click();
  await shot(page, "cap-08-waiter");
  await page.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(page.getByRole("dialog", { name: "Waiter ticket" }).getByRole("region", { name: /confirmed/ })).toBeVisible();
  await shot(page, "cap-09-waiter-confirmed");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Rounds 2 (canary) and 3 (pink, open) with a correction.
  await page.getByRole("button", { name: "Start round 2" }).click();
  await addDish(guest.page, "Extra Rice", 3);
  await expect(page.getByText("Extra Rice")).toBeVisible();
  await confirmCurrent(page, id);
  await api(page, `/api/sessions/${id}/rounds`, "POST");
  await addDish(guest.page, "Mango Shake", 2);
  const snap = (await api(page, `/api/sessions/${id}/sync`, "GET")).data;
  const katsu = snap.entries.find((e: { dishName: string; instructions: string | null }) => e.dishName === "Chicken Katsu" && !e.instructions);
  await api(page, `/api/sessions/${id}/corrections`, "POST", { sourceEntryId: katsu.id, type: "QUANTITY", quantity: 1 });
  await page.reload();
  await page.getByRole("tab", { name: /Rounds/ }).click();
  await scrollTo(page, 0);
  await shot(page, "cap-10-rounds-top");
  const round2 = await page.getByRole("region", { name: "Round 2, confirmed with the waiter" }).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  // Scroll so round 2 sits just under the sticky header.
  await scrollTo(page, round2 - 90);
  await shot(page, "cap-11-rounds-history");

  await guest.page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await guest.page.goto(`/i/${code}`);
  const joiner = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const joinPage = await joiner.newPage();
  await joinPage.goto(`/i/${code}`);
  await shot(joinPage, "cap-12-join-dark");
  await joiner.close();

  await api(page, `/api/sessions/${id}/close`, "POST");
  await page.reload();
  await expect(page.getByText(/This order has ended/)).toBeVisible();
  await scrollTo(page, 0);
  await shot(page, "cap-13-ended");

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await shot(page, "cap-14-landing-desktop-dark");

  await writeFile(`${DIR}/cap-15-og-landing.png`, await (await request.get("/opengraph-image")).body());
  await guest.context.close();
});
