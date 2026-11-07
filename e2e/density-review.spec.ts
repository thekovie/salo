import { expect, test, type Page } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

// Every screen at 320 and 390 px for a crowding/density review. Skipped unless UX_REVIEW=1.
test.skip(!process.env.UX_REVIEW, "set UX_REVIEW=1");
test.setTimeout(120_000);
const DIR = ".impeccable/review/density";
const sizes = [
  ["320", { width: 320, height: 640 }],
  ["390", { width: 390, height: 844 }],
] as const;

for (const [label, viewport] of sizes) {
  test(`all screens at ${label}`, async ({ page, browser }) => {
    const shot = (p: Page, name: string) => p.screenshot({ path: `${DIR}/${label}-${name}.png` });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("salo:tour:host", "dismissed"));

    await page.goto("/");
    await shot(page, "01-landing");
    await startOrder(page);
    await shot(page, "02-order-empty");
    await page.getByRole("textbox", { name: "Dish" }).fill("Chicken Inasal with extra java rice");
    await page.locator('[data-tour="for"]').click();
    await page.getByRole("radio", { name: "+ Someone else", exact: true }).click();
    await page.getByLabel("Person's name").fill("Tita Marites");
    await page.getByRole("button", { name: "Size or notes", exact: true }).click();
    await shot(page, "03-composer-open");
    await page.getByRole("button", { name: /^Add/ }).first().click();
    await addDish(page, "Sinigang na baboy", 2);
    await addDish(page, "Halo-halo");

    const code = await inviteCode(page);
    await page.getByRole("button", { name: "Invite" }).click();
    await shot(page, "04-invite-sheet");
    await page.getByRole("dialog", { name: "Invite the table" }).getByRole("button", { name: "Close" }).click();

    const stranger = await browser.newContext({ viewport });
    const inv = await stranger.newPage();
    await inv.goto(`/i/${code}`);
    await shot(inv, "05-invite-page");
    await stranger.close();

    const guest = await joinAsGuest(browser, code, "Jose Dela Cruz");
    await guest.page.setViewportSize(viewport);
    await addDish(guest.page, "Lechon kawali");
    await guest.page.waitForTimeout(800);
    await shot(guest.page, "06-guest-order");

    await page.waitForTimeout(1500);
    await shot(page, "07-host-order-full");
    for (const tab of ["People", "Groups", "Rounds"]) {
      await page.getByRole("tab", { name: new RegExp(tab) }).click();
      await shot(page, `08-tab-${tab.toLowerCase()}`);
    }
    await page.getByRole("tab", { name: /Order/ }).click();
    await page.getByRole("button", { name: /^Edit Halo-halo/ }).first().click({ force: true });
    await shot(page, "09-edit-sheet");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Order options" }).click();
    await shot(page, "10-options-sheet");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Review order" }).click();
    await shot(page, "11-review");
    await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
    await shot(page, "12-waiter");
    await page.getByRole("button", { name: "Mark confirmed with waiter" }).click();
    await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForTimeout(800);
    await shot(page, "13-whats-next");
    await page.getByRole("button", { name: "End the order" }).click();
    await page.getByRole("button", { name: /Yes, end the order/ }).click();
    await expect(page.getByRole("dialog", { name: /Who ordered what/ })).toBeVisible();
    await shot(page, "14-summary");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await shot(page, "15-ended");
    await guest.context.close();
  });
}
