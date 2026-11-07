import { expect, test } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, orderFor, startOrder } from "./support/helpers";

test("edit a dish's size, notes and who it's for; undo a quantity change (finding 6)", async ({ page, browser }) => {
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Halo-halo");
  await page.getByRole("button", { name: "Edit Halo-halo" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit Halo-halo" });
  await sheet.getByRole("radio", { name: "JD", exact: true }).click();
  await sheet.getByLabel("Size or variant").fill("Large");
  await sheet.getByLabel("Instructions").fill("Less ice");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  const row = page.getByTestId("dish-row").filter({ hasText: "Halo-halo" });
  await expect(row).toContainText("JD");
  await expect(row).toContainText("Large");
  await expect(row).toContainText("Less ice");
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();

  // Quantity changes can be undone (brief 6.5).
  await page.getByRole("button", { name: "One more Halo-halo" }).click();
  await expect(row).toContainText("2");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row.getByText("2", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();

  // The guest sees it on their own card and can claim it (finding 7).
  await guest.page.getByRole("tab", { name: /People/ }).click();
  await expect(guest.page.getByRole("button", { name: /That’s mine|That's mine/ }).first()).toBeVisible();
  await guest.context.close();
});

test("who's-it-for chips work with the keyboard: one Tab stop, arrows select", async ({ page }) => {
  await startOrder(page);
  await orderFor(page, "Me");
  const me = page.getByRole("radio", { name: "Me", exact: true });
  await me.focus();
  await expect(me).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("ArrowRight");
  const next = page.getByRole("radio").nth(1);
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute("aria-checked", "true");
  await expect(me).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("End");
  await expect(page.getByRole("radio", { name: "+ New group" })).toHaveAttribute("aria-checked", "true");
});
