import { expect, test } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, orderFor, startOrder } from "./support/helpers";

test("ending the order offers 'who ordered what' to copy or save; guests can open it too", async ({ page, browser, context, request }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Chicken Inasal Paa", 2);
  await orderFor(page, "A person", "Miguel");
  await addDish(page, "Java Rice");
  await addDish(guest.page, "Halo-halo");
  // The host reviews what they can see; wait for the guest's dish to arrive first, or confirming is (rightly)
  // refused as out of date.
  await expect(page.getByTestId("dish-row").filter({ hasText: "Halo-halo" })).toBeVisible();
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();

  // Confirm round 1 with the waiter.
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await waiter.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(waiter.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();

  // End the order: the summary opens by itself for the host.
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: "End order" }).click();
  await page.getByRole("dialog", { name: "End this order?" }).getByRole("button", { name: "Yes, end the order" }).click();
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Summary preview")).toContainText("Miguel");
  await expect(sheet.getByLabel("Summary preview")).toContainText("JD");

  await sheet.getByRole("button", { name: "Copy text" }).click();
  await expect(sheet.getByText("Copied. Paste it in your group chat.")).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("Who ordered what (round 1)");
  expect(text).toMatch(/Miguel: 1 item\n {2}Java Rice ×1/);
  expect(text).toContain("JD: 1 item\n  Halo-halo ×1");
  expect(text).toContain("Total: 4 items · no prices included");

  // Save image: a PNG download (or the share sheet, on phones that support sharing files).
  const download = page.waitForEvent("download");
  await sheet.getByRole("button", { name: "Save image" }).click();
  expect((await download).suggestedFilename()).toMatch(/^salo-.*\.png$/);

  // Guests get it from the ended order too.
  await guest.page.reload();
  await guest.page.getByRole("button", { name: "Who ordered what" }).click();
  await expect(guest.page.getByRole("dialog", { name: "Who ordered what" })).toContainText("Chicken Inasal Paa");

  // Strangers get nothing.
  const sessionId = new URL(page.url()).pathname.split("/").pop();
  expect((await request.get(`/api/sessions/${sessionId}/summary`)).status()).toBe(404);
  await guest.context.close();
});
