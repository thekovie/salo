import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addDish, confirmRound1, inviteCode, joinAsGuest, openDetail, startOrder } from "./support/helpers";

const dockHeight = (page: Page) => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--dock-h")));

test("composer at 320: two rows at rest, expands when focused, a basic dish needs no extra tap, details sit behind + Details", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await startOrder(page);
  const form = page.getByRole("form", { name: "Add a dish" });
  const dish = form.getByRole("textbox", { name: "Dish" });

  await expect(form.getByRole("button", { name: /^For / })).toBeVisible();
  await expect(form.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: "Details" })).toHaveCount(0);
  await expect(form.getByRole("group", { name: /Quantity of/ })).toHaveCount(0);
  const rest = await dockHeight(page);

  await dish.focus();
  await expect(form.getByRole("button", { name: "Details" })).toBeVisible();
  await expect(form.getByRole("group", { name: /Quantity of/ })).toBeVisible();
  await expect(form.getByRole("button", { name: "One more this dish" })).toBeVisible();
  // The bottom bar is hidden while focused, so the dock is not simply taller; it must still be measured.
  expect(await dockHeight(page)).toBeGreaterThan(0);
  expect(rest).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // A basic dish: Dish → Add, nothing in between.
  await dish.fill("Gyoza");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("dish-row").filter({ hasText: "Gyoza" })).toBeVisible();

  // Details: one tap on + Details opens the chips; filled ones keep removable tags and the chip counts them.
  await dish.fill("Sisig");
  await expect(form.getByRole("button", { name: "+ Size", exact: true })).toHaveCount(0);
  await openDetail(page, "Size");
  await form.getByRole("textbox", { name: "Size or variant" }).fill("Large");
  await openDetail(page, "Note");
  await form.getByRole("textbox", { name: "Instructions" }).fill("No sauce");
  await expect(form.getByRole("button", { name: "Details, 2 added" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Remove size Large" })).toBeVisible();
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("dish-row").filter({ hasText: "No sauce" })).toBeVisible();
});

test("the bottom bar hides while the composer has focus and returns on blur", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await startOrder(page);
  const bar = page.getByTestId("round-total");
  const dish = page.getByRole("textbox", { name: "Dish" });
  await expect(bar).toBeVisible();

  await dish.focus();
  await expect(bar).toBeHidden();
  await expect(page.getByRole("button", { name: "Review order" })).toBeHidden();

  await page.mouse.click(160, 200);
  await expect(dish).not.toBeFocused();
  await expect(bar).toBeVisible();
  await expect(page.getByRole("button", { name: "Review order" })).toBeVisible();

  // Tapping For at rest opens its panel without expanding the composer under the finger.
  await page.getByRole("button", { name: /^For / }).click();
  await expect(page.getByRole("radio", { name: "Anyone", exact: true })).toBeVisible();
});

test("My share: one tap opens KKB on your own card, for the guest and the host; the label follows the prices", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 640 });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await openDetail(page, "Price");
  await page.getByLabel("Price each (₱)").fill("120");
  await addDish(page, "Chicken Katsu", 2);
  await addDish(guest.page, "Iced Tea");
  await expect(page.getByTestId("dish-row").filter({ hasText: "Iced Tea" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^My share/ })).toHaveCount(0);
  await confirmRound1(page);

  const hostShare = page.getByRole("button", { name: "My share · ₱240" });
  await expect(hostShare).toBeVisible();
  await hostShare.click();
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await expect(sheet.getByRole("tab", { name: "KKB" })).toHaveAttribute("aria-selected", "true");
  await expect(sheet.getByRole("region", { name: /your share/ })).toBeFocused({ timeout: 15_000 });
  await page.keyboard.press("Escape");

  await expect(guest.page.getByRole("button", { name: "My share · no prices yet" })).toBeVisible({ timeout: 15_000 });
  await guest.page.getByRole("button", { name: "My share · no prices yet" }).click();
  const guestSheet = guest.page.getByRole("dialog", { name: "Who ordered what" });
  await expect(guestSheet.getByRole("region", { name: /your share/ })).toBeFocused({ timeout: 15_000 });
  await guestSheet.getByRole("button", { name: "Add price, Iced Tea" }).click();
  await guestSheet.getByRole("form", { name: "Price for Iced Tea" }).getByLabel("Price each (₱)").fill("60");
  await guestSheet.getByRole("form", { name: "Price for Iced Tea" }).getByRole("button", { name: "Save" }).click();
  await guest.page.keyboard.press("Escape");
  await expect(guest.page.getByRole("button", { name: "My share · ₱60" })).toBeVisible({ timeout: 15_000 });
  await expect(guest.page.getByRole("button", { name: /Ticket/ })).toBeVisible();
  await expect(guest.page.getByRole("button", { name: "My share · ₱60" })).toContainText("Share ₱60");
  const dockAxe = await new AxeBuilder({ page: guest.page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(dockAxe.violations).toEqual([]);
  expect(await guest.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // An ended order: "Who ordered what" opens on KKB at the viewer's card.
  await page.getByRole("button", { name: "End the order" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Yes, end the order" }).click();
  await page.getByRole("dialog", { name: "Who ordered what" }).waitFor();
  await page.keyboard.press("Escape");
  await expect(page.getByText("This order has ended")).toBeVisible({ timeout: 15_000 });
  await expect(guest.page.getByText("This order has ended")).toBeVisible({ timeout: 15_000 });
  await guest.page.getByRole("button", { name: "Who ordered what" }).click();
  const ended = guest.page.getByRole("dialog", { name: "Who ordered what" });
  await expect(ended.getByRole("tab", { name: "KKB" })).toHaveAttribute("aria-selected", "true");
  await expect(ended.getByRole("region", { name: /your share/ })).toBeFocused({ timeout: 15_000 });
});

test("one round-label class on the ticket heading, the Served tag and the header status", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig");
  await expect(page.locator("#ticket-title")).toHaveClass(/round-label/);
  await expect(page.locator("header .round-label")).toContainText("Round 1 · Open");
  await confirmRound1(page);
  const served = page.getByTestId("served-section");
  await expect(served.locator(".round-label").first()).toHaveText("Round 1");
  await expect(page.getByRole("region", { name: /^Round 1, confirmed/ }).getByRole("heading", { name: "Round 1" })).toHaveClass(/round-label/);
  const style = await served.locator(".round-label").first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { transform: s.textTransform, spacing: s.letterSpacing, weight: s.fontWeight };
  });
  expect(style.transform).toBe("uppercase");
  expect(style.weight).toBe("500");
});

test("touch: the first tap on For at rest opens its panel, and the Undo tap right after Add lands", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await startOrder(page);
  await page.getByRole("button", { name: /^For / }).tap();
  await expect(page.getByRole("radio", { name: "Anyone", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^For / }).tap();

  const dish = page.getByRole("textbox", { name: "Dish" });
  await dish.fill("Gyoza");
  await page.getByRole("button", { name: "Add", exact: true }).tap();
  await expect(page.getByTestId("dish-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).tap();
  await expect(page.getByTestId("dish-row")).toHaveCount(0);
});

test("keyboard: Tab from the Dish after Add reaches Review order; Escape in the Dish brings the bar back", async ({ page }) => {
  await startOrder(page);
  const dish = page.getByRole("textbox", { name: "Dish" });
  await dish.fill("Gyoza");
  await dish.press("Enter");
  await expect(page.getByTestId("dish-row")).toHaveCount(1);
  const review = page.getByRole("button", { name: "Review order" });
  const onReview = () => page.evaluate(() => document.activeElement?.textContent?.includes("Review order") ?? false);
  for (let i = 0; i < 25 && !(await onReview()); i++) await page.keyboard.press("Tab");
  await expect(review).toBeFocused();

  await dish.focus();
  await expect(page.getByTestId("round-total")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dish).not.toBeFocused();
  await expect(page.getByTestId("round-total")).toBeVisible();
});

test("re-expanding the composer leaves focus on the Dish, not on a detail field", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await startOrder(page);
  const dish = page.getByRole("textbox", { name: "Dish" });
  await dish.click();
  await page.getByRole("button", { name: "+ ₱ Price", exact: true }).click();
  await expect(page.getByLabel("Price each (₱)")).toBeFocused();
  await page.mouse.click(180, 150);
  await expect(page.getByRole("button", { name: /Price/ })).toHaveCount(0);
  await dish.click();
  await expect(dish).toBeFocused();
  await expect(page.getByLabel("Price each (₱)")).toHaveCount(0);
});

test("undo from a compact Fully served row keeps focus on that dish in Waiting, on screen (x1 and x3)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 640 });
  await startOrder(page);
  await addDish(page, "Soup");
  await addDish(page, "Gyoza", 3);
  for (let i = 0; i < 8; i++) await addDish(page, `Filler ${i}`);
  await confirmRound1(page);
  const section = page.getByTestId("served-section");
  for (const name of ["Soup", "Gyoza"]) await section.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name: /All served/ }).click();
  await expect(section.getByText("Fully served (2)")).toBeVisible({ timeout: 15_000 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);

  for (const [name, less] of [["Soup", "One less Soup served"], ["Gyoza", "One less Gyoza served"]] as const) {
    await section.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await section.getByRole("button", { name: less }).click();
    const waiting = section.locator('[data-serve-group="waiting"]').filter({ hasText: name });
    await expect(waiting).toBeVisible({ timeout: 15_000 });
    const focused = page.locator(":focus");
    await expect(waiting.locator(":focus")).toHaveCount(1);
    await expect.poll(async () => {
      const box = (await focused.boundingBox())!;
      return box.y >= 0 && box.y + box.height <= 640;
    }).toBe(true);
  }
});
