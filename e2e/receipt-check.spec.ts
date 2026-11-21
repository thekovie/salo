import { expect, test, type Page } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

async function confirmRound(page: Page) {
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await waiter.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(waiter.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
}

test("receipt check, price completeness and Copy summary across two phones", async ({ page, browser, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Chicken Katsu");
  await addDish(guest.page, "Iced Tea");
  await expect(page.getByTestId("dish-row").filter({ hasText: "Iced Tea" })).toBeVisible();
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await confirmRound(page);

  await page.getByRole("button", { name: "Enter receipt prices (KKB)" }).click();
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await expect(sheet.getByText("0 of 2 dishes priced")).toBeVisible();
  await sheet.getByRole("button", { name: "Show the 2 without a price" }).click();
  await expect(sheet.getByRole("button", { name: "Add price, Chicken Katsu" })).toBeFocused();

  for (const [dish, amount] of [["Chicken Katsu", "120"], ["Iced Tea", "60"]]) {
    await sheet.getByRole("button", { name: `Add price, ${dish}` }).click();
    const form = sheet.getByRole("form", { name: `Price for ${dish}` });
    await form.getByLabel("Price each (₱)").fill(amount);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toBeHidden();
  }
  await expect(sheet.getByText("All prices in")).toBeVisible();

  const receipt = sheet.getByRole("region", { name: "Check against the receipt" });
  await sheet.getByLabel("Service charge from receipt (₱)").fill("18");
  await sheet.getByRole("region", { name: "Service charge" }).getByRole("button", { name: "Save" }).click();
  await expect(receipt.getByText("₱198.00")).toBeVisible();
  await receipt.getByLabel("Receipt total (₱)").fill("234");
  await receipt.getByRole("button", { name: "Save" }).click();
  await expect(receipt.getByText("₱36.00 more on the receipt. Not split. Check the receipt for items missing in Salo.")).toBeVisible();

  await guest.page.getByRole("tab", { name: /People/ }).click();
  await guest.page.getByRole("button", { name: "Who ordered what" }).click();
  const guestSheet = guest.page.getByRole("dialog", { name: "Who ordered what" });
  await guestSheet.getByRole("tab", { name: "KKB" }).click();
  await expect(guestSheet.getByRole("region", { name: /JD, your share/ })).toContainText("₱66.00");
  const guestReceipt = guestSheet.getByRole("region", { name: "Check against the receipt" });
  await expect(guestReceipt.getByText("₱234.00")).toBeVisible();
  await expect(guestReceipt.getByText("₱36.00 more on the receipt.", { exact: false })).toBeVisible();
  await expect(guestReceipt.getByLabel("Receipt total (₱)")).toHaveCount(0);
  await expect(guestSheet.getByRole("button", { name: "Copy summary" })).toBeVisible();

  await sheet.getByRole("button", { name: "Copy summary" }).click();
  await expect(sheet.getByText("Summary copied")).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("₱120.00 + ₱12.00 service = ₱132.00");
  expect(text).toContain("JD  ₱60.00 + ₱6.00 service = ₱66.00");
  expect(text).toContain("Total ₱198.00");
  expect(text).toContain("Made with Salo");

  await receipt.getByLabel("Receipt total (₱)").fill("198");
  await receipt.getByRole("button", { name: "Save" }).click();
  await expect(receipt.getByText("Matches the receipt.")).toBeVisible();
  await guest.context.close();
});
