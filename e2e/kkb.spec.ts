import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, openNotes, orderFor, startOrder } from "./support/helpers";

async function confirmRound(page: Page) {
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await waiter.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(waiter.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
}

test("KKB: price while ordering, price from the receipt, bill a shared dish, split the service charge live", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const code = await inviteCode(page);
  const guest = await joinAsGuest(browser, code, "JD");

  // A price while ordering: the subtotal shows before saving.
  await openNotes(page);
  await page.getByLabel("Price each (₱)").fill("120");
  await page.getByRole("textbox", { name: "Dish" }).fill("Chicken Katsu");
  await page.getByRole("button", { name: "One more this dish" }).click();
  await expect(page.getByText("₱120.00 × 2 = ₱240.00")).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Dish" })).toHaveValue("");

  // An invalid price is refused in words, nothing is added.
  await openNotes(page);
  await page.getByLabel("Price each (₱)").fill("1.234");
  await page.getByRole("textbox", { name: "Dish" }).fill("Mystery");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Price: Up to 2 decimal places." })).toBeVisible();
  await page.getByLabel("Price each (₱)").fill("");
  await page.getByRole("textbox", { name: "Dish" }).fill("");

  // A shared dish without a price, and a guest's dish without a price.
  await orderFor(page, "Whole table");
  await addDish(page, "Gyoza platter");
  await addDish(guest.page, "Iced Tea");
  await expect(page.getByTestId("dish-row").filter({ hasText: "Iced Tea" })).toBeVisible();
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await confirmRound(page);

  // The host enters the receipt's prices from "What's next?".
  await page.getByRole("button", { name: "Enter receipt prices (KKB)" }).click();
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await expect(sheet.getByRole("tab", { name: "KKB" })).toHaveAttribute("aria-selected", "true");
  await expect(sheet.getByRole("region", { name: /your share/ })).toContainText("₱240.00");

  await sheet.getByRole("button", { name: "Add price, Iced Tea" }).click();
  await sheet.getByRole("form", { name: "Price for Iced Tea" }).getByLabel("Price each (₱)").fill("60");
  await sheet.getByRole("form", { name: "Price for Iced Tea" }).getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByRole("form", { name: "Price for Iced Tea" })).toBeHidden();

  const platter = sheet.getByRole("form", { name: "Price for Gyoza platter" });
  await sheet.getByRole("button", { name: "Add price, Gyoza platter" }).click();
  await platter.getByLabel("Price each (₱)").fill("360");
  await platter.getByText("JD", { exact: true }).click();
  await platter.getByRole("button", { name: "Save" }).click();
  await expect(platter).toBeHidden();
  await expect(sheet.getByText("Billed to JD")).toBeVisible();

  // Service charge: a failed save keeps the amount and retries safely.
  await page.route("**/service-charge", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Something went wrong on our side." } }) }), { times: 1 });
  const charge = sheet.getByLabel("Service charge from receipt (₱)");
  await charge.fill("66");
  await sheet.getByRole("region", { name: "Service charge" }).getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByRole("alert").filter({ hasText: "Not saved." })).toBeVisible();
  await expect(charge).toHaveValue("66");
  await sheet.getByRole("button", { name: "Try again" }).click();
  await expect(sheet.getByText(/split by how much each person ordered/)).toBeVisible();
  // ₱240 of ₱660 food → ₱24.00 of ₱66.00.
  await expect(sheet.getByRole("region", { name: /your share/ })).toContainText("Total with service charge₱264.00");

  // The guest sees their own share arrive live: ₱60 tea + ₱360 platter + ₱42 service charge.
  await guest.page.getByRole("tab", { name: /People/ }).click();
  await guest.page.getByRole("button", { name: "Who ordered what" }).click();
  const guestSheet = guest.page.getByRole("dialog", { name: "Who ordered what" });
  await guestSheet.getByRole("tab", { name: "KKB" }).click();
  await expect(guestSheet.getByRole("region", { name: /JD, your share/ })).toContainText("₱462.00");
  await expect(guestSheet.getByRole("button", { name: /Add price/ })).toHaveCount(0);
  expect((await new AxeBuilder({ page: guest.page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

  // Prices never reach the waiter's ticket or the invite page.
  const sessionId = new URL(page.url()).pathname.split("/").pop();
  const waiter = await page.context().newPage();
  await waiter.goto(`/s/${sessionId}/waiter`);
  await expect(waiter.getByText("Chicken Katsu")).toBeVisible();
  expect(await waiter.locator("body").innerText()).not.toContain("₱");
  const stranger = await browser.newContext();
  const invite = await stranger.newPage();
  await invite.goto(`/i/${code}`);
  expect(await invite.locator("body").innerText()).not.toContain("₱");
  await stranger.close();
  await guest.context.close();
});

test("KKB: the host can add their name, light and dark pass axe", async ({ page }) => {
  await startOrder(page);
  await addDish(page, "Sisig");
  await page.getByRole("tab", { name: /People/ }).click();
  await page.getByRole("button", { name: "Who ordered what" }).click();
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await expect(sheet.getByRole("tab", { name: "KKB" })).toHaveAttribute("aria-selected", "true");
  await sheet.getByLabel("Add your name so the table knows which dishes are yours").fill("Kovie");
  await sheet.getByRole("button", { name: "Save" }).first().click();
  await expect(sheet.getByRole("region", { name: "Kovie, your share" })).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
});
