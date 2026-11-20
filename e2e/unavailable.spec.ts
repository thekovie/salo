import { expect, test, type Page } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

async function confirmRound1(page: Page) {
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await waiter.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(waiter.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
}

async function pickLine(page: Page, line: RegExp | string) {
  const change = page.getByRole("button", { name: /Change a dish/ });
  await change.click();
  const picker = page.getByRole("dialog", { name: "Change a dish" });
  await expect(picker.getByRole("searchbox")).toHaveCount(0);
  await picker.getByRole("button", { name: line }).click();
  return change;
}

test("scenario C: the waiter says Sisig is out; it comes off at once for everyone, round 1's ticket stays as printed", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Sisig");
  await addDish(guest.page, "Sisig");
  await addDish(guest.page, "Rice");
  await expect(page.getByTestId("dish-row").filter({ hasText: "Rice" })).toBeVisible();
  await confirmRound1(page);

  await page.getByRole("tab", { name: /Rounds/ }).click();
  await pickLine(page, "Sisig ×2");
  const sheet = page.getByRole("dialog", { name: /Change Sisig/ });
  await sheet.getByRole("radio", { name: "Unavailable" }).click();
  await expect(sheet.getByText("All 2 Sisig, every size, come off now.")).toBeVisible();
  await sheet.getByRole("button", { name: "Mark unavailable" }).click();
  const confirm = page.getByRole("dialog", { name: "Mark Sisig unavailable?" });
  await expect(confirm).toContainText("This can’t be undone.");
  await confirm.getByRole("button", { name: "Mark unavailable" }).click();
  await expect(page.getByText("Sisig marked unavailable · 2 cancelled.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);

  // Listed as told, round 1's ticket unchanged.
  await expect(page.getByRole("region", { name: "Corrections" })).toContainText("Sisig ×2 cancelled");
  await expect(page.getByRole("region", { name: "Corrections" })).toContainText("Unavailable · Told the waiter");
  await page.getByRole("button", { name: /^Round 1 · Confirmed/ }).click();
  await expect(page.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toContainText("Sisig");
  await expect(page.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toContainText("3 items");

  // The guest's Items and KKB no longer bill it.
  await guest.page.getByRole("tab", { name: /People/ }).click();
  await guest.page.getByRole("button", { name: "Who ordered what" }).click();
  const summary = guest.page.getByRole("dialog", { name: "Who ordered what" });
  await expect(summary.getByLabel("Summary preview")).toContainText("Rice", { timeout: 15_000 });
  await expect(summary.getByLabel("Summary preview")).not.toContainText("Sisig");
  await summary.getByRole("tab", { name: "KKB" }).click();
  await expect(summary).toContainText("Rice");
  await expect(summary).not.toContainText("Sisig");
});

test("Cancel some across two people while round 2 is open, then Remove takes the whole change back", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Chicken Katsu", 2);
  await addDish(guest.page, "Chicken Katsu", 2);
  await expect(page.getByTestId("dish-row").filter({ hasText: "Chicken Katsu" })).toBeVisible();
  await confirmRound1(page);

  await page.getByRole("tab", { name: /Rounds/ }).click();
  const summary = page.getByRole("button", { name: /^Round 1 · Confirmed .* · 1 dish · 4 items$/ });
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toHaveCount(0);
  await summary.click();
  await expect(page.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible();
  await pickLine(page, "Chicken Katsu ×4");
  const sheet = page.getByRole("dialog", { name: /Change Chicken Katsu/ });
  await expect(sheet.getByText("Start round 2 to send changes to the waiter.")).toBeVisible();
  await sheet.getByRole("button", { name: "Start round 2" }).click();
  const fix = page.getByRole("dialog", { name: /Change Chicken Katsu/ });
  await expect(fix.getByRole("button", { name: "Save change" })).toBeVisible({ timeout: 15_000 });
  await expect(fix.getByText("Cancels: nobody yet")).toBeVisible();
  await expect(fix.getByRole("button", { name: "Save change" })).toBeDisabled();
  const pluses = fix.getByRole("button", { name: /One more Chicken Katsu to cancel/ });
  await pluses.first().click();
  await expect(fix.getByRole("button", { name: "Save change" })).toBeEnabled();
  await pluses.first().click();
  await pluses.last().click();
  await expect(fix.getByText(/^Cancels: \S+ ×2, \S+ ×1$/)).toBeVisible();
  await fix.getByRole("button", { name: "Save change" }).click();

  const list = page.getByRole("region", { name: "Corrections" });
  await expect(list).toContainText("Chicken Katsu −3");
  await expect(list).toContainText("Pending · goes with round 2");
  await list.getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByRole("region", { name: "Corrections" })).toHaveCount(0);
});

test("the unavailable confirm keeps keyboard focus inside and Escape closes only it", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig");
  await confirmRound1(page);

  await page.getByRole("tab", { name: /Rounds/ }).click();
  const change = await pickLine(page, "Sisig ×1");
  const sheet = page.getByRole("dialog", { name: /Change Sisig/ });
  const pills = await sheet.getByRole("radio").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  expect(new Set(pills.map(Math.round)).size, "the mode pills share one row").toBe(1);
  await sheet.getByRole("radio", { name: "Unavailable" }).click();
  const trigger = sheet.getByRole("button", { name: "Mark unavailable" });
  await trigger.click();
  const confirm = page.getByRole("dialog", { name: "Mark Sisig unavailable?" });
  const inConfirm = () => page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]")));
  await expect(confirm.getByRole("button", { name: "Not now" })).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(await inConfirm()).toBe(true);
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await inConfirm()).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect(trigger).toBeFocused();

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect(change).toBeFocused();
});

test("the dish search shows only with 8 or more lines, and Back returns to the list", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const dishes = ["Sisig", "Rice", "Gyoza", "Ramen", "Udon", "Tempura", "Mochi", "Edamame"];
  for (const dish of dishes) await addDish(page, dish);
  await confirmRound1(page);

  await page.getByRole("tab", { name: /Rounds/ }).click();
  await page.getByRole("button", { name: /Change a dish/ }).click();
  const picker = page.getByRole("dialog", { name: "Change a dish" });
  const search = picker.getByRole("searchbox", { name: "Search dishes" });
  await expect(search).toBeVisible();
  await search.fill("  GYO");
  await expect(picker.getByRole("button", { name: /^Gyoza ×1$/ })).toBeVisible();
  await expect(picker.getByRole("button", { name: /^Rice/ })).toHaveCount(0);
  await picker.getByRole("button", { name: /^Gyoza/ }).click();
  const sheet = page.getByRole("dialog", { name: /Change Gyoza/ });
  await sheet.getByRole("button", { name: "All dishes" }).click();
  await expect(page.getByRole("dialog", { name: "Change a dish" })).toBeVisible();
});

test("a replaced dish stays as history; its replacement is its own line and cancelling it leaves the original alone", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig", 2);
  await confirmRound1(page);

  await page.getByRole("tab", { name: /Rounds/ }).click();
  await pickLine(page, "Sisig ×2");
  const sheet = page.getByRole("dialog", { name: /Change Sisig/ });
  await sheet.getByRole("radio", { name: "Unavailable" }).click();
  await sheet.getByLabel(/Replace with/).fill("Pork Belly");
  await sheet.getByRole("button", { name: "Mark unavailable" }).click();
  await page.getByRole("dialog", { name: "Mark Sisig unavailable?" }).getByRole("button", { name: "Mark unavailable" }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });

  await page.getByRole("button", { name: /Change a dish/ }).click();
  const picker = page.getByRole("dialog", { name: "Change a dish" });
  await expect(picker).toContainText("Sisig");
  await expect(picker).toContainText("×2 — Replaced");
  await expect(picker.getByRole("button", { name: /^Sisig/ })).toHaveCount(0);
  const replacement = picker.getByRole("button", { name: "Pork Belly ×2, replacement for Sisig" });
  await expect(replacement).toContainText("Replacement");
  await expect(picker.getByRole("listitem").filter({ hasText: "×2 — Replaced" }).locator("xpath=following-sibling::li[1]")).toContainText("Pork Belly");
  await replacement.click();
  const fix = page.getByRole("dialog", { name: /Change Pork Belly/ });
  await expect(fix.getByRole("radio")).toHaveCount(2);
  await expect(fix.getByText("Cancel it instead")).toBeVisible();
  await fix.getByRole("button", { name: "Start round 2" }).click();
  await fix.getByRole("button", { name: /One more Pork Belly to cancel/ }).click({ timeout: 15_000 });
  await fix.getByRole("button", { name: "Save change" }).click();
  await expect(page.getByRole("region", { name: "Corrections" })).toContainText("Pork Belly −1", { timeout: 15_000 });

  await page.getByRole("button", { name: /Change a dish/ }).click();
  const again = page.getByRole("dialog", { name: "Change a dish" });
  await expect(again).toContainText("×2 — Replaced");
  await expect(again.getByRole("button", { name: "Pork Belly ×1, replacement for Sisig" })).toBeVisible();
});

test("cancelling the last line of a round returns focus to that round's summary button", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig");
  await confirmRound1(page);

  await page.getByRole("tab", { name: /Rounds/ }).click();
  await pickLine(page, "Sisig ×1");
  const sheet = page.getByRole("dialog", { name: /Change Sisig/ });
  await sheet.getByRole("button", { name: "Start round 2" }).click();
  await sheet.getByRole("button", { name: /One more Sisig to cancel/ }).click({ timeout: 15_000 });
  await sheet.getByRole("button", { name: "Save change" }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Change a dish/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Round 1 · Confirmed/ })).toBeFocused({ timeout: 15_000 });
});

test("removing a dish from the Order tab keeps focus on the next row, then the Dish field", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig");
  await addDish(page, "Rice");
  await expect(page.getByTestId("dish-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Remove Rice/ })).toBeEnabled({ timeout: 15_000 });

  await page.getByRole("button", { name: /^Remove Sisig/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dish-row")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Remove Rice/ })).toBeFocused({ timeout: 15_000 });

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dish-row")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Dish", exact: true })).toBeFocused({ timeout: 15_000 });
});

test("removing a dish beside a merged multi-person dish still lands focus on a real control", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Sisig");
  await addDish(page, "Rice");
  await addDish(guest.page, "Rice");
  await expect(page.getByTestId("dish-row")).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByTestId("dish-row").filter({ hasText: "Rice" })).toContainText("2", { timeout: 15_000 });

  const sisigRemove = page.getByRole("button", { name: /^Remove Sisig/ });
  await expect(sisigRemove).toBeEnabled({ timeout: 15_000 });
  await sisigRemove.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dish-row")).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && document.activeElement?.tagName), { timeout: 15_000 }).toMatch(/BUTTON|INPUT/);
});

test("a dish removed on another phone never leaves the host's focus on the page body", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Sisig");
  await addDish(guest.page, "Rice");
  const hostRice = page.getByTestId("dish-row").filter({ hasText: "Rice" });
  await expect(hostRice).toBeVisible({ timeout: 15_000 });

  await hostRice.getByRole("button", { name: /Remove Rice|One less Rice/ }).focus();
  await guest.page.getByRole("button", { name: /^Remove Rice/ }).click();
  await expect(hostRice).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("dish-row").filter({ hasText: "Sisig" }).locator(":focus")).toHaveCount(1, { timeout: 15_000 });
});
