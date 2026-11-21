import { expect, test, type Page } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

async function confirmRound(page: Page, n: number) {
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("dialog", { name: `Review round ${n}` }).getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await waiter.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: new RegExp(`Confirm round ${n}`) }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(waiter.getByRole("region", { name: `Round ${n}, confirmed with the waiter` })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
}

const summary = (page: Page) => page.getByTestId("served-summary");

test("scenario D: food arrives in batches; host taps, All served, filters; guest watches read-only; End order warns but ends", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Chicken Katsu", 2);
  await addDish(guest.page, "Chicken Katsu", 3);
  await addDish(page, "Gyoza", 1);
  await expect(page.getByTestId("dish-row").filter({ hasText: "Gyoza" })).toBeVisible();
  await expect(page.getByTestId("served-section")).toHaveCount(0);
  await confirmRound(page, 1);

  const section = page.getByTestId("served-section");
  await expect(section).toBeVisible();
  await expect(summary(page)).toHaveText("0 of 6 served · 6 waiting");
  await expect(guest.page.getByTestId("served-summary")).toHaveText("0 of 6 served · 6 waiting", { timeout: 15_000 });
  await expect(guest.page.getByTestId("served-section").getByRole("button", { name: /One more/ })).toHaveCount(0);

  const katsu = section.getByRole("listitem").filter({ hasText: "Chicken Katsu" });
  await katsu.getByRole("button", { name: "One more Chicken Katsu served" }).click({ clickCount: 3, delay: 20 });
  await expect(katsu).toContainText("3 of 5 served · 2 waiting");
  await expect(guest.page.getByTestId("served-section")).toContainText("3 of 5 served · 2 waiting", { timeout: 15_000 });
  await expect(summary(guest.page)).toHaveText("3 of 6 served · 3 waiting");

  await katsu.getByRole("button", { name: "One less Chicken Katsu served" }).click();
  await expect(katsu).toContainText("2 of 5 served");
  await section.getByRole("listitem").filter({ hasText: "Gyoza" }).getByRole("button", { name: /All served/ }).click();
  await expect(section.getByRole("listitem").filter({ hasText: "Gyoza" })).toContainText("✓ Served 1");

  await section.getByRole("button", { name: "Served", exact: true }).click();
  await expect(section.getByRole("listitem")).toHaveCount(1);
  await section.getByRole("button", { name: /^Waiting/ }).click();
  await expect(section.getByRole("listitem")).toHaveCount(1);
  await katsu.getByRole("button", { name: /All served/ }).click();
  await expect(section.getByRole("listitem")).toHaveCount(0);
  await expect(summary(page)).toHaveText("All 6 served. Kain na!");
  await section.getByRole("button", { name: "All", exact: true }).click();

  await katsu.getByRole("button", { name: "One less Chicken Katsu served" }).click();
  await expect(summary(guest.page)).toHaveText("5 of 6 served · 1 waiting", { timeout: 15_000 });

  await page.getByRole("button", { name: "End the order" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("1 item still waiting to be served. You can still end the order.");
  await sheet.getByRole("button", { name: "Yes, end the order" }).click();
  await page.getByRole("dialog", { name: "Who ordered what" }).waitFor();
  await page.keyboard.press("Escape");
  await expect(page.getByText("This order has ended")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Order" }).click();
  await expect(page.getByTestId("served-section")).toBeVisible();
  await expect(page.getByTestId("served-section").getByRole("button", { name: /One more/ })).toHaveCount(0);
});

test("the section never shows before the first confirm and stays above the draft during round 2", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig", 2);
  await expect(page.getByTestId("served-section")).toHaveCount(0);
  await confirmRound(page, 1);
  await expect(page.getByTestId("served-section")).toBeVisible();
  await page.getByRole("button", { name: /Add more \(round 2\)/ }).click();
  await addDish(page, "Rice");
  await expect(page.getByTestId("served-section")).toBeVisible();
  await expect(page.getByTestId("served-section")).toContainText("Round 1");
  await expect(page.getByTestId("served-section")).not.toContainText("Rice");
});

test("a tap survives leaving the tab; Change… on a Served row; a replaced dish keeps its served count as history (D21)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Sisig", 5);
  await confirmRound(page, 1);

  const sent: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/serving") && r.request().method() === "POST" && r.ok()) sent.push(JSON.parse(r.request().postData() ?? "{}").delta);
  });
  const section = page.getByTestId("served-section");
  await expect(section.getByRole("button", { name: "Waiting 5" })).toBeVisible();
  const bar = section.getByRole("progressbar", { name: "Food served" });
  await expect(bar).toHaveAttribute("aria-valuemax", "5");
  const row = section.getByRole("listitem").filter({ hasText: "Sisig" });
  await row.getByRole("button", { name: "One more Sisig served" }).click({ clickCount: 2, delay: 20 });
  await expect(row).toContainText("2 of 5 served");
  await expect(bar).toHaveAttribute("aria-valuenow", "2");

  await row.getByRole("button", { name: "One more Sisig served" }).click();
  await page.getByRole("tab", { name: /Rounds/ }).click();
  await page.getByRole("tab", { name: "Order" }).click();
  await expect(page.getByTestId("served-section")).toContainText("3 of 5 served");
  await expect.poll(() => sent.reduce((a, b) => a + b, 0), { timeout: 15_000 }).toBe(3);
  await page.reload();
  await expect(page.getByTestId("served-section")).toContainText("3 of 5 served", { timeout: 15_000 });

  await page.getByTestId("served-section").getByRole("button", { name: /^Change… Sisig, round 1/ }).click();
  const sheet = page.getByRole("dialog", { name: /Change Sisig/ });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radio", { name: "Unavailable" }).click();
  await sheet.getByLabel(/Replace with/).fill("Pork Belly");
  await sheet.getByRole("button", { name: "Mark unavailable" }).click();
  await page.getByRole("dialog", { name: "Mark Sisig unavailable?" }).getByRole("button", { name: "Mark unavailable" }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });

  await page.getByRole("tab", { name: "Order" }).click();
  const served = page.getByTestId("served-section");
  const history = served.getByRole("listitem").filter({ hasText: "3 served · rest replaced" });
  await expect(history).toContainText("Sisig");
  await expect(history.getByRole("button")).toHaveCount(0);
  await expect(served.getByRole("listitem").filter({ hasText: "Pork Belly" })).toContainText("0 of 2 served · 2 waiting");
  await expect(summary(page)).toHaveText("3 of 5 served · 2 waiting");
});
