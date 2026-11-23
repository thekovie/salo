import { expect, test } from "@playwright/test";
import { addDish, confirmRound1, startOrder, openKkb } from "./support/helpers";

test("a served tap and a KKB price made offline are sent on reconnect, without Try again (follow-up 21)", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig", 3);
  await confirmRound1(page);

  const row = page.getByTestId("served-section").getByRole("listitem").filter({ hasText: "Sisig" });
  await context.setOffline(true);
  await row.getByRole("button", { name: "One more Sisig served" }).click();
  await expect(row.getByRole("alert")).toContainText("Couldn’t save this.", { timeout: 15_000 });
  await context.setOffline(false);
  await expect(row.getByRole("alert")).toHaveCount(0, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId("served-section").getByRole("listitem").filter({ hasText: "Sisig" })).toContainText("1 of 3 served");

  await openKkb(page);
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await sheet.getByRole("button", { name: "Add price, Sisig" }).click();
  const form = sheet.getByRole("form", { name: "Price for Sisig" });
  await form.getByLabel("Price each (₱)").fill("150");
  await context.setOffline(true);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toContainText("Not saved.", { timeout: 15_000 });
  await context.setOffline(false);
  await expect(form).toBeHidden({ timeout: 15_000 });
  await expect(sheet.getByRole("region", { name: /your share/ })).toContainText("₱450.00");

  // A Clear that failed offline is retried as a Clear, not as a Save of the typed amount.
  await sheet.getByRole("button", { name: /^Edit price .*, Sisig$/ }).click();
  await context.setOffline(true);
  await form.getByRole("button", { name: /Remove table price|Clear price/ }).click();
  await expect(form.getByRole("alert")).toContainText("Not saved.", { timeout: 15_000 });
  await context.setOffline(false);
  await expect(form).toBeHidden({ timeout: 15_000 });
  await expect(sheet.getByRole("button", { name: "Add price, Sisig" })).toBeVisible({ timeout: 15_000 });
});
