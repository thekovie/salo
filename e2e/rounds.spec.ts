import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

const axe = (page: import("@playwright/test").Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("review, waiter view, host-only confirmation, round 2 with a correction, end session (scenarios 9, 10, 11, 13)", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "Rafa");
  await addDish(page, "Chicken Katsu", 3);
  await addDish(guest.page, "Iced Tea", 2);
  await expect(page.getByTestId("dish-row").filter({ hasText: "Iced Tea" })).toBeVisible();

  // Guests can look at the ticket but have no way to confirm (scenario 10).
  await guest.page.getByRole("button", { name: "Ticket" }).click();
  await expect(guest.page.getByRole("dialog", { name: "Waiter ticket" })).toContainText("5 items");
  await expect(guest.page.getByRole("button", { name: "Mark confirmed with waiter" })).toHaveCount(0);
  await guest.page.getByRole("button", { name: "Back" }).click();

  // Review (scenario 9): checks plus the ticket; showing the waiter does not confirm.
  await page.getByRole("button", { name: "Review order" }).click();
  const review = page.getByRole("dialog", { name: "Review round 1" });
  await expect(review.getByText("Everything is saved.")).toBeVisible();
  await expect(review.getByText(/0 of 1 guest ready/)).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);
  await review.getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await expect(waiter).toContainText("Chicken Katsu");
  await expect(waiter).toContainText("×3");
  expect((await axe(page)).violations).toEqual([]);

  await waiter.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(waiter.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();

  // Everyone sees round 1 confirmed; nobody can add to it.
  await expect(guest.page.getByText(/The host confirmed round 1/)).toBeVisible();
  await expect(guest.page.getByRole("textbox", { name: "Dish" })).toHaveCount(0);

  // Round 2 (scenario 11): only new dishes plus an explicit correction.
  await page.getByRole("button", { name: "Start round 2" }).click();
  await addDish(guest.page, "Extra Rice", 3);
  await page.getByRole("tab", { name: /Rounds/ }).click();
  await page.getByRole("button", { name: "Correct a dish" }).click();
  const fix = page.getByRole("dialog", { name: "Correct round 1" });
  await fix.getByLabel("Dish").selectOption({ label: "Chicken Katsu ×3" });
  await fix.getByRole("button", { name: "Add correction" }).click();
  await expect(page.getByText("Cancel 1 × Chicken Katsu from round 1").first()).toBeVisible();

  await page.getByRole("tab", { name: /Order/ }).click();
  await page.getByRole("button", { name: "Review order" }).click();
  const review2 = page.getByRole("dialog", { name: "Review round 2" });
  await expect(review2).toContainText("Extra Rice");
  await expect(review2).toContainText("Cancel 1 × Chicken Katsu from round 1");
  await expect(review2).not.toContainText("Iced Tea");
  await review2.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 2/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(page.getByRole("dialog", { name: "Waiter ticket" }).getByRole("region", { name: "Round 2, confirmed with the waiter" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();

  // Both rounds kept, each stamped; round 1 untouched.
  await page.getByRole("tab", { name: /Rounds/ }).click();
  await expect(page.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toContainText("5 items");
  await expect(page.getByRole("region", { name: "Round 2, confirmed with the waiter" })).toContainText("3 items");

  // End session (scenario 13): read-only for everyone.
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: "End order" }).click();
  await page.getByRole("dialog", { name: "End this order?" }).getByRole("button", { name: "Yes, end the order" }).click();
  await expect(page.getByText(/This order has ended/)).toBeVisible();
  await guest.page.reload();
  await expect(guest.page.getByText(/This order has ended/)).toBeVisible();
  await expect(guest.page.getByRole("button", { name: "Invite" })).toHaveCount(0);
  expect((await axe(guest.page)).violations).toEqual([]);
  await guest.context.close();
});

test("confirmation is refused when the order changed after the host looked", async ({ page, browser }) => {
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Gyoza", 2);
  await page.getByRole("button", { name: "Review order" }).click();
  // Stop live updates on the host's phone, then the guest adds something.
  await page.context().setOffline(true);
  await addDish(guest.page, "Rice");
  await page.context().setOffline(false);
  const sessionId = page.url().split("/s/")[1];
  const status = await page.evaluate(async (id) => {
    const snap = await (await fetch(`/api/sessions/${id}/sync`)).json();
    const round = snap.data.activeRoundId;
    const r = await fetch(`/api/sessions/${id}/rounds/${round}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ expectedRevision: snap.data.session.revision - 1 }),
    });
    return r.status;
  }, sessionId);
  expect(status).toBe(409);
  await guest.context.close();
});
