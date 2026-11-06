import { expect, test } from "@playwright/test";
import { addDish, startOrder } from "./support/helpers";

test("motion: counts tick in the direction they move; the wash survives reduced motion; the stamp waits a beat", async ({ page }) => {
  await startOrder(page);
  await addDish(page, "Gyoza");
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();

  await page.getByRole("button", { name: "One more Gyoza" }).click();
  await expect(page.getByTestId("dish-row").locator('.tick[data-dir="up"]').first()).toBeAttached();
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await page.getByRole("button", { name: "One less Gyoza" }).click();
  await expect(page.getByTestId("dish-row").locator('.tick[data-dir="down"]').first()).toBeAttached();

  // With reduced motion, movement stops but the "this just changed" wash keeps its full length.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await addDish(page, "Gyoza");
  const wash = page.locator('[data-dish="gyoza"] .wash');
  await expect(wash).toBeAttached();
  expect(await wash.evaluate((el) => getComputedStyle(el).animationDuration)).toBe("0.9s");
  const tickDuration = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "tick";
    probe.dataset.dir = "up";
    document.body.append(probe);
    const value = getComputedStyle(probe).animationDuration;
    probe.remove();
    return value;
  });
  expect(parseFloat(tickDuration)).toBeLessThan(0.001);

  // The stamp lands 280 ms after the confirmed ticket appears.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  const stamp = page.getByRole("dialog", { name: "Waiter ticket" }).locator('[aria-hidden="true"]', { hasText: "Confirmed" }).first();
  await expect(stamp).toBeAttached();
  expect(await stamp.evaluate((el) => getComputedStyle(el).animationDelay)).toBe("0.28s");
});
