import { expect, test } from "@playwright/test";
import { startOrder } from "./support/helpers";

const DISHES = ["Chicken Katsu", "Gyoza", "Iced Tea", "Crispy Pata", "Rice", "Halo-halo", "Pancit", "Sisig", "Lumpia", "Mango Shake"];

// Brief 14: at least 20 participants and 100 entries without significant degradation. These are local measurements on
// the CI/dev machine, logged for the record, with generous ceilings that catch regressions, not benchmarks.
test("100 entries for 20 people stay quick to load and to change", async ({ page }) => {
  await startOrder(page);
  const sessionId = page.url().split("/s/")[1];
  const seeded = await page.evaluate(
    async ({ id, dishes }) => {
      const started = performance.now();
      for (let i = 0; i < 100; i++) {
        const person = `Person ${(i % 20) + 1}`;
        const body = { dishName: dishes[i % dishes.length], quantity: 1 + (i % 3), variant: i % 7 === 0 ? "Large" : null, attribution: { type: "INDIVIDUAL", label: person } };
        const r = await fetch(`/api/sessions/${id}/entries`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
        if (r.status !== 201) throw new Error(`seed ${i}: ${r.status}`);
      }
      return Math.round((performance.now() - started) / 100);
    },
    { id: sessionId, dishes: DISHES },
  );

  const loadStart = Date.now();
  await page.reload();
  await expect(page.getByTestId("dish-row")).toHaveCount(DISHES.length);
  const loadMs = Date.now() - loadStart;

  const tapStart = Date.now();
  await page.getByRole("textbox", { name: "Dish" }).fill("Calamansi Juice");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("dish-row").filter({ hasText: "Calamansi Juice" })).toBeVisible();
  const addVisibleMs = Date.now() - tapStart;
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  const addSavedMs = Date.now() - tapStart;

  await page.getByRole("tab", { name: /People/ }).click();
  await expect(page.getByText("Person 20")).toBeVisible();

  test.info().annotations.push({ type: "measurements", description: JSON.stringify({ avgAddMs: seeded, loadMs, addVisibleMs, addSavedMs }) });
  console.log(`load measurements: average add ${seeded} ms, reload ${loadMs} ms, new dish visible ${addVisibleMs} ms, saved ${addSavedMs} ms`);
  expect(addVisibleMs).toBeLessThan(1000);
  expect(loadMs).toBeLessThan(5000);
});
