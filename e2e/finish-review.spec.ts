import { expect, test } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

// Screenshots of the end-of-meal journey for a UX review. Skipped unless UX_REVIEW=1.
test.skip(!process.env.UX_REVIEW, "set UX_REVIEW=1");
const DIR = ".impeccable/review/finish";

for (const [label, viewport] of [
  ["phone", { width: 390, height: 844 }],
  ["small", { width: 320, height: 640 }],
] as const) {
  test(`end of meal on ${label}`, async ({ page, browser }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startOrder(page);
    const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
    await guest.page.setViewportSize(viewport);
    await addDish(page, "Chicken Inasal", 2);
    await addDish(guest.page, "Halo-halo");
    await expect(page.getByTestId("dish-row").filter({ hasText: "Halo-halo" })).toBeVisible();
    await page.screenshot({ path: `${DIR}/${label}-1-header.png` });
    await page.getByRole("button", { name: "Review order" }).click();
    await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
    await page.getByRole("button", { name: "Mark confirmed with waiter" }).click();
    await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${DIR}/${label}-2-waiter-confirmed.png` });
    await page.getByRole("button", { name: "Back" }).click();
    await page.screenshot({ path: `${DIR}/${label}-3-whats-next.png`, fullPage: true });
    await guest.page.waitForTimeout(1500);
    await guest.page.screenshot({ path: `${DIR}/${label}-4-guest-after-confirm.png`, fullPage: true });
    await page.getByRole("button", { name: "End the order" }).click();
    await page.screenshot({ path: `${DIR}/${label}-5-end-confirm.png` });
    await guest.context.close();
  });
}
