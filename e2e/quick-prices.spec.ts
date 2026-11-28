import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addDish, confirmRound1, inviteCode, joinAsGuest, openDetail, openKkb, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };
const sheetOf = (page: Page) => page.getByRole("dialog", { name: "Enter prices" });
const field = (page: Page, dish: string) => sheetOf(page).getByRole("textbox", { name: `Price each for ${dish}` });
const dockPrices = (page: Page, left: number) => page.getByRole("button", { name: `Enter prices · ${left} left` });

/** One host order of Sisig ×3, confirmed: a single row to price. */
async function sisigConfirmed(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig", 3);
  await confirmRound1(page);
}

test("quick prices: three prices without closing the sheet, guest share live, own price kept, focus back on the dock", async ({ page, browser }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");

  await addDish(page, "Chicken Katsu");
  await addDish(page, "Iced Tea", 2);
  // The host's own Sinigang carries its own price (300); the guest's does not.
  await openDetail(page, "Price");
  await page.getByLabel("Price each (₱)").fill("300");
  await page.getByRole("textbox", { name: "Dish" }).fill("Sinigang");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Dish" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Dish" }).press("Escape");
  await addDish(guest.page, "Chicken Katsu");
  await addDish(guest.page, "Sinigang");
  await expect(page.getByTestId("dish-row").filter({ hasText: "JD" })).toHaveCount(2, T);
  await confirmRound1(page);

  // Entry points: What's next row and the dock.
  await expect(page.getByRole("region", { name: "What’s next?" }).getByText("3 prices left")).toBeVisible();
  await expect(guest.page.getByRole("button", { name: "Share · no prices yet" })).toBeVisible(T);
  const opener = dockPrices(page, 3);
  await opener.click();
  const sheet = sheetOf(page);
  await expect(sheet.getByText("3 prices left · a price covers every order of that dish and size")).toBeVisible();
  await expect(sheet.getByText("1 of 2 has its own price")).toBeVisible();

  // Enter moves to the next empty field; the last one ends on "done"; the sheet stays open.
  await expect(field(page, "Chicken Katsu")).toHaveAttribute("enterkeyhint", "next");
  await field(page, "Chicken Katsu").fill("120");
  await field(page, "Chicken Katsu").press("Enter");
  await expect(field(page, "Iced Tea")).toBeFocused();
  await field(page, "Iced Tea").fill("60");
  await field(page, "Iced Tea").press("Enter");
  await expect(field(page, "Sinigang")).toBeFocused();
  await expect(field(page, "Sinigang")).toHaveAttribute("enterkeyhint", "done");
  await field(page, "Sinigang").fill("250");
  await field(page, "Sinigang").press("Enter");
  await expect(sheet.getByText("All prices in")).toBeVisible(T);
  await expect(sheet.getByText("Saved")).toHaveCount(3, T);
  await expect(sheet).toBeVisible();

  // The guest's share arrives live: Katsu 120 + their Sinigang at the table price 250.
  await expect(guest.page.getByRole("button", { name: /^Share( so far)? ₱370$/ })).toBeVisible(T);

  // Closing: the host's own Sinigang kept its 300 (not the table price); focus returns to the dock button.
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden(T);
  await expect(page.getByRole("button", { name: /^Share( so far)? ₱540$/ })).toBeFocused(T);
  await expect(page.getByRole("region", { name: "What’s next?" }).getByText("Next: add the service charge from the receipt")).toBeVisible();
  await guest.context.close();
});

test("quick prices: a price typed offline is kept, shows Not saved, and is sent when the connection returns", async ({ page, context }) => {
  await sisigConfirmed(page);
  await dockPrices(page, 1).click();
  const sheet = sheetOf(page);
  await context.setOffline(true);
  await field(page, "Sisig").fill("150");
  await field(page, "Sisig").press("Enter");
  await expect(sheet.getByRole("alert")).toContainText("Not saved.", T);
  await expect(field(page, "Sisig")).toHaveValue("150");
  await context.setOffline(false);
  await expect(sheet.getByRole("alert")).toHaveCount(0, T);
  await expect(sheet.getByText("Saved")).toBeVisible(T);
  await expect(sheet.getByText("All prices in")).toBeVisible(T);
});

test("quick prices: an unsaved value is restored on reopen as Not saved, and Try again sends it", async ({ page, context }) => {
  await sisigConfirmed(page);
  await dockPrices(page, 1).click();
  const sheet = sheetOf(page);
  await context.setOffline(true);
  await field(page, "Sisig").fill("150");
  await field(page, "Sisig").blur();
  await expect(sheet.getByRole("alert")).toContainText("Not saved.", T);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden(T);
  await context.setOffline(false);

  await dockPrices(page, 1).click();
  await expect(field(page, "Sisig")).toHaveValue("150");
  await expect(sheet.getByRole("alert")).toContainText("Not saved");
  await sheet.getByRole("button", { name: "Try again" }).click();
  await expect(sheet.getByText("All prices in")).toBeVisible(T);
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: /^Share( so far)? ₱450$/ })).toBeVisible(T);
});

test("quick prices: a change from another phone shows the conflict, also when the draft is reopened later", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig", 3);
  await addDish(page, "Iced Tea");
  await confirmRound1(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await dockPrices(other, 2).click();
  await dockPrices(page, 2).click();

  await field(page, "Sisig").fill("90");
  await field(other, "Sisig").fill("100");
  await field(other, "Sisig").press("Enter");
  await expect(sheetOf(other).getByText("Saved")).toBeVisible(T);

  const sheet = sheetOf(page);
  await expect(sheet.getByRole("alert")).toContainText("Someone changed this just now to ₱100.00. Your amount is still here.", T);
  await expect(field(page, "Sisig")).toHaveValue("90");
  // The draft survives closing; reopening opens straight into the conflict.
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden(T);
  await dockPrices(page, 1).click();
  await expect(sheetOf(page).getByRole("alert")).toContainText("Someone changed this just now to ₱100.00", T);
  await sheetOf(page).getByRole("button", { name: "Keep mine" }).click();
  await expect(sheetOf(page).getByText("Saved")).toBeVisible(T);
  await expect(field(page, "Sisig")).toHaveValue("90.00");
  await other.close();
});

test("quick prices: a replacement dish has its own row", async ({ page }) => {
  await sisigConfirmed(page);
  await page.getByRole("tab", { name: /Rounds/ }).click();
  await page.getByRole("button", { name: /Change a dish/ }).click();
  await page.getByRole("dialog", { name: "Change a dish" }).getByRole("button", { name: "Sisig ×3" }).click();
  const change = page.getByRole("dialog", { name: /Change Sisig/ });
  await change.getByRole("radio", { name: "Unavailable" }).click();
  await change.getByLabel(/Replace with/).fill("Pork Belly");
  await change.getByRole("button", { name: "Mark unavailable" }).click();
  await page.getByRole("dialog", { name: "Mark Sisig unavailable?" }).getByRole("button", { name: "Mark unavailable" }).click();
  await expect(change).toBeHidden(T);
  // "Unavailable" with a replacement takes effect at once: the replacement is its own priced line.
  await dockPrices(page, 1).click();
  const sheet = sheetOf(page);
  await expect(sheet.getByText("Pork Belly (replaces Sisig)")).toBeVisible();
  await field(page, "Pork Belly (replaces Sisig)").fill("200");
  await field(page, "Pork Belly (replaces Sisig)").press("Enter");
  await expect(sheet.getByText("All prices in")).toBeVisible(T);
  await expect(sheet.getByText("Saved")).toBeVisible(T);
});

test("quick prices: the sheet passes axe in light and dark", async ({ page }) => {
  await sisigConfirmed(page);
  await dockPrices(page, 1).click();
  await field(page, "Sisig").fill("150");
  await field(page, "Sisig").press("Enter");
  await expect(sheetOf(page).getByText("Saved")).toBeVisible(T);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
});

test("quick prices: a price changed again while its first save is in flight is saved, not thrown away", async ({ page }) => {
  await sisigConfirmed(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  await page.route("**/api/sessions/*/prices", async (route) => {
    if (first && route.request().method() === "PUT") {
      first = false;
      await held;
    }
    await route.continue();
  });
  await dockPrices(page, 1).click();
  const sheet = sheetOf(page);
  await field(page, "Sisig").fill("120");
  await field(page, "Sisig").press("Enter");
  await expect(sheet.getByText("Saving…")).toBeVisible(T);
  await field(page, "Sisig").fill("125");
  await field(page, "Sisig").blur();
  release();
  await expect(field(page, "Sisig")).toHaveValue("125.00", T);
  await expect(sheet.getByText("Saved")).toBeVisible(T);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: /^Share( so far)? ₱375$/ })).toBeVisible(T);
});

test("quick prices: Enter on an invalid amount keeps focus on the field", async ({ page }) => {
  await sisigConfirmed(page);
  await dockPrices(page, 1).click();
  await field(page, "Sisig").fill("12.345");
  await field(page, "Sisig").press("Enter");
  await expect(field(page, "Sisig")).toBeFocused();
});

test("quick prices: a value restored as Not saved is sent by itself when the connection returns", async ({ page, context }) => {
  await sisigConfirmed(page);
  await dockPrices(page, 1).click();
  const sheet = sheetOf(page);
  await context.setOffline(true);
  await field(page, "Sisig").fill("150");
  await field(page, "Sisig").blur();
  await expect(sheet.getByRole("alert")).toContainText("Not saved.", T);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden(T);
  await dockPrices(page, 1).click();
  await expect(field(page, "Sisig")).toHaveValue("150");
  await context.setOffline(false);
  await expect(sheet.getByText("All prices in")).toBeVisible(T);
});

test("quick prices: after closing the sheet from KKB, Tab moves on and focus isn't pulled back", async ({ page }) => {
  await sisigConfirmed(page);
  await openKkb(page);
  const enter = page.getByRole("button", { name: "Enter prices", exact: true });
  await enter.click();
  await expect(sheetOf(page)).toBeVisible(T);
  await sheetOf(page).getByRole("button", { name: "Close" }).click();
  await expect(sheetOf(page)).toBeHidden(T);
  await expect(enter).toBeFocused(T);
  await page.keyboard.press("Tab");
  await expect(enter).not.toBeFocused();
  // Outlast focusWhenFree's 50 ms retry so a re-grab would show.
  await page.waitForTimeout(600);
  await expect(enter).not.toBeFocused();
});
