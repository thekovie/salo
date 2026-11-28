import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { confirmRound1, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const DEADLINE = { timeout: 15_000 };
const DISHES = ["Sisig", "Lumpia", "Pancit", "Crispy Pata", "Kare-kare", "Halo-halo", "Bulalo", "Adobo", "Sinigang", "Lechon", "Gyoza", "Iced Tea", "Rice", "Mango Shake", "Turon"];

/** 15 dishes over 8 typed names (limits: src/server/orders/validation.ts), round 1 confirmed. Optionally a guest joins first. */
async function largeOrder(page: Page, browser: import("@playwright/test").Browser, guestName?: string) {
  await startOrder(page);
  const id = page.url().split("/s/")[1];
  const guest = guestName ? await joinAsGuest(browser, await inviteCode(page), guestName) : null;
  await page.evaluate(
    async ({ id, dishes }) => {
      for (const [i, dishName] of dishes.entries()) {
        const body = { dishName, quantity: 1 + (i % 3), variant: null, attribution: { type: "INDIVIDUAL", label: `Person ${(i % 8) + 1}` } };
        const r = await fetch(`/api/sessions/${id}/entries`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
        if (r.status !== 201) throw new Error(`seed ${i}: ${r.status}`);
      }
    },
    { id, dishes: DISHES },
  );
  await page.reload();
  await confirmRound1(page);
  return guest;
}

test("a long confirmed ticket folds, Waiting is capped, and Find a dish narrows it", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await largeOrder(page, browser);
  const served = page.getByTestId("served-section");

  // R1: closed by default, opens to today's ticket, closes again.
  const ticketButton = page.getByRole("button", { name: /^Round 1/ });
  await expect(ticketButton).toHaveAttribute("aria-expanded", "false", DEADLINE);
  await expect(page.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toHaveCount(0);
  await ticketButton.click();
  await expect(ticketButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible(DEADLINE);
  expect((await axe(page)).violations).toEqual([]);
  await ticketButton.click();
  await expect(page.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toHaveCount(0);

  // R2: first 10, Show all, Show fewer.
  const rows = served.locator('[data-serve-group="waiting"]');
  await expect(rows).toHaveCount(10, DEADLINE);
  const showAll = served.getByRole("button", { name: "Show all 15 waiting dishes" });
  await expect(showAll).toHaveAttribute("aria-expanded", "false");
  await showAll.click();
  await expect(rows).toHaveCount(15, DEADLINE);
  const fewer = served.getByRole("button", { name: "Show fewer" });
  await expect(fewer).toHaveAttribute("aria-expanded", "true");
  await fewer.click();
  await expect(rows).toHaveCount(10, DEADLINE);

  // R4: match, no match, clear.
  const find = served.getByRole("searchbox", { name: "Find a dish" });
  await find.fill("sisig");
  await expect(rows).toHaveCount(1, DEADLINE);
  await expect(served.getByRole("status").filter({ hasText: "1 dish matches" })).toBeVisible();
  await expect(served.getByRole("button", { name: /Show all/ })).toHaveCount(0);
  await find.fill("pizza");
  await expect(served.getByRole("status").filter({ hasText: "No dish matches." })).toBeVisible(DEADLINE);
  await expect(rows).toHaveCount(0);
  await find.fill("");
  await expect(rows).toHaveCount(10, DEADLINE);
  expect((await axe(page)).violations).toEqual([]);

  // N9: serving the one match removes the focused row; focus must stay inside the list.
  await find.fill("sisig");
  await expect(rows).toHaveCount(1, DEADLINE);
  // Keyboard, as Safari does not focus a tapped button.
  const serve = rows.first().getByRole("button", { name: /All served/ });
  await serve.focus();
  await serve.press("Enter");
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="served-section"]')) && document.activeElement !== document.body), DEADLINE)
    .toBe(true);

  // D63: the query survives Change… → Rounds → back to Order.
  await page.getByRole("tab", { name: /Rounds/ }).click();
  await page.getByRole("tab", { name: "Order" }).click();
  await expect(served.getByRole("searchbox", { name: "Find a dish" })).toHaveValue("sisig");
});

test("People collapses to headers on a large table; a guest's own card leads and is open", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const guest = await largeOrder(page, browser, "Bea");
  if (!guest) throw new Error("no guest");

  await page.getByRole("tab", { name: /People/ }).click();
  const headers = page.getByRole("heading", { level: 3 }).getByRole("button");
  await expect(headers).toHaveCount(9, DEADLINE);
  await expect(page.locator('h3 button[aria-expanded="true"]')).toHaveCount(0);
  const person = page.getByRole("button", { name: /Show Person 1.s order/ });
  await person.click();
  await expect(person).toHaveAttribute("aria-expanded", "true");
  const region = page.locator(`[id="${await person.getAttribute("aria-controls")}"]`);
  await expect(region).toContainText("Sisig", DEADLINE);
  expect((await axe(page)).violations).toEqual([]);

  await guest.page.getByRole("tab", { name: /People/ }).click();
  const first = guest.page.getByRole("heading", { level: 3 }).first().getByRole("button");
  await expect(first).toContainText("Bea", DEADLINE);
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(guest.page.locator('h3 button[aria-expanded="false"]')).toHaveCount(8);
  expect((await axe(guest.page)).violations).toEqual([]);
  await guest.context.close();
});
