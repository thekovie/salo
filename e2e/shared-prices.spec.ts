import { expect, test } from "@playwright/test";
import { inviteCode, joinAsGuest, startOrder, openKkb } from "./support/helpers";

async function addLarge(page: import("@playwright/test").Page, dish: string, price?: string) {
  await page.getByRole("textbox", { name: "Dish" }).fill(dish);
  await page.getByRole("button", { name: "+ Size", exact: true }).click();
  await page.getByRole("textbox", { name: "Size or variant" }).fill("Large");
  if (price) {
    await page.getByRole("button", { name: "+ ₱ Price", exact: true }).click();
    await page.getByLabel("Price each (₱)").fill(price);
  }
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Dish" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Dish" }).press("Escape"); // focus returns to the Dish after Add, which hides the bottom bar
}

test("table price: one price for every Chicken Katsu (Large), shown live to the guest, with a per-line override", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const code = await inviteCode(page);
  const guest = await joinAsGuest(browser, code, "JD");

  await addLarge(page, "Chicken Katsu");
  await addLarge(guest.page, "Chicken Katsu");
  await expect(page.getByTestId("round-total")).toContainText("2 items");
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await waiter.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(waiter.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();

  await openKkb(page);
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  const form = sheet.getByRole("form", { name: /Price for Chicken Katsu/ });

  // 3. "Every …" prices both lines.
  await sheet.getByRole("button", { name: "Add price, Chicken Katsu (Large)" }).first().click();
  await expect(form.getByRole("radio", { name: "Every Chicken Katsu (Large) here (2 lines)" })).toBeChecked();
  await form.getByLabel("Price each (₱)").fill("120");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(sheet.getByText("₱120.00 each · table price")).toHaveCount(2);

  // ...live on the guest's phone, read-only.
  await guest.page.getByRole("tab", { name: /People/ }).click();
  await guest.page.getByRole("button", { name: "Who ordered what" }).click();
  const guestSheet = guest.page.getByRole("dialog", { name: "Who ordered what" });
  await guestSheet.getByRole("tab", { name: "KKB" }).click();
  await expect(guestSheet.getByText("₱120.00 each · table price")).toHaveCount(2);

  // 4. "Only this line" overrides one; the other keeps the table price.
  await sheet.getByRole("button", { name: /Edit price ₱120.00, Chicken Katsu/ }).first().click();
  await form.getByRole("radio", { name: "Only this line" }).check();
  await form.getByLabel("Price each (₱)").fill("100");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(sheet.getByText("₱100.00 each · this line only")).toHaveCount(1);
  await expect(sheet.getByText("₱120.00 each · table price")).toHaveCount(1);
  await expect(guestSheet.getByText(/each · (this line only|table price)/)).toHaveCount(2);
  await guest.context.close();
});

test("an untouched Save on a line with its own price changes nothing (not the table price either)", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const code = await inviteCode(page);
  const guest = await joinAsGuest(browser, code, "JD");

  await addLarge(guest.page, "Chicken Katsu", "100");
  await addLarge(page, "Chicken Katsu");
  await expect(page.getByTestId("round-total")).toContainText("2 items");
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await waiter.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(waiter.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();

  await openKkb(page);
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  const form = sheet.getByRole("form", { name: /Price for Chicken Katsu/ });

  // The host's own line sets the table price through "Every ...".
  await sheet.getByRole("button", { name: "Add price, Chicken Katsu (Large)" }).click();
  await form.getByLabel("Price each (₱)").fill("120");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(sheet.getByText("₱120.00 each · table price")).toHaveCount(1);
  await expect(sheet.getByText("₱100.00 each · this line only")).toHaveCount(1);

  // Opening the guest's line and saving without a change must leave everything as it was.
  await sheet.getByText("JD", { exact: true }).click(); // the guest's card starts collapsed
  await sheet.getByRole("button", { name: /Edit price ₱100.00, Chicken Katsu/ }).click();
  await expect(form.getByRole("radio", { name: "Only this line" })).toBeChecked();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(sheet.getByText("₱100.00 each · this line only")).toHaveCount(1);
  await expect(sheet.getByText("₱120.00 each · table price")).toHaveCount(1);
  await guest.context.close();
});
