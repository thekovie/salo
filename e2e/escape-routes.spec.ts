import { expect, test, type Page } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

/**
 * Every screen needs a visible way out (owner feedback, 2026-11-07: "no exit button or back button"). A screen
 * passes if it shows a link home or a Back/Close control a person can see and reach.
 */
async function expectWayOut(page: Page, where: string) {
  const exits = page.locator('a[href="/"]:visible, button:visible').filter({ hasText: /back|close|not now|home/i });
  const homeLinks = page.locator('a[href="/"]:visible');
  const count = (await exits.count()) + (await homeLinks.count());
  expect(count, `${where} has no visible way out`).toBeGreaterThan(0);
}

test("every screen has a way out", async ({ page, browser }) => {
  for (const path of ["/privacy", "/cookies", "/this-page-does-not-exist"]) {
    await page.goto(path);
    await expectWayOut(page, path);
  }

  await startOrder(page);
  await expectWayOut(page, "the order (host)");
  const code = await inviteCode(page);

  const stranger = await browser.newContext();
  const invitePage = await stranger.newPage();
  await invitePage.goto(`/i/${code}`);
  await expectWayOut(invitePage, "the invite page");
  await stranger.close();

  const guest = await joinAsGuest(browser, code, "JD");
  await expectWayOut(guest.page, "the order (guest)");

  await addDish(page, "Sisig");
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await guest.context.close();
});
