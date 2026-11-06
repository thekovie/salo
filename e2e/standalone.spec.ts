import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openNotes, orderFor } from "./support/helpers";

async function startOrder(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start an order" }).click();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Wala pang order.")).toBeVisible();
}

async function addDish(page: Page, name: string, quantity = 1) {
  const dish = page.getByRole("textbox", { name: "Dish" });
  await dish.fill(name);
  for (let i = 1; i < quantity; i++) await page.getByRole("button", { name: "One more this dish" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dish).toHaveValue("");
}

const items = (page: Page) => page.getByTestId("round-total");

test("host-only ordering: start, add dishes, consolidate, waiter ticket (scenarios 1, 5, 9)", async ({ page }) => {
  await startOrder(page);
  await addDish(page, "Chicken Katsu", 2);
  await addDish(page, "chicken katsu");
  await addDish(page, "Chicken Cutlet");
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();

  const rows = page.getByTestId("dish-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Chicken Katsu");
  await expect(rows.first()).toContainText("×3");
  await expect(items(page)).toContainText("4");

  // Suggestions offer dishes already in this order.
  await page.getByRole("textbox", { name: "Dish" }).fill("chick");
  await expect(page.getByRole("button", { name: "Chicken Katsu", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Dish" }).fill("");

  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await expect(waiter.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await expect(waiter).toContainText("4 items");
  await waiter.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back to order" }).click();
  await expect(rows).toHaveCount(2);
});

test("variants and instructions stay distinct; recipient is kept between entries (scenario 6)", async ({ page }) => {
  await startOrder(page);
  // The host orders for themselves unless they pick someone else.
  await expect(page.getByRole("button", { name: /^For Me/ })).toBeVisible();
  await orderFor(page, "A person", "Miguel");
  await openNotes(page);
  await page.getByRole("textbox", { name: "Size or variant" }).fill("Large");
  await addDish(page, "Iced Tea");
  // Size resets, recipient stays (now a one-tap chip).
  await expect(page.getByRole("textbox", { name: "Size or variant" })).toHaveValue("");
  await expect(page.getByRole("radio", { name: "Miguel", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: /^For Miguel/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Instructions" }).fill("Less ice");
  await addDish(page, "Iced Tea");
  await page.getByRole("radio", { name: "Anyone" }).click();
  await addDish(page, "Iced Tea");

  const row = page.getByTestId("dish-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("×3");
  await expect(row).toContainText("Large");
  await expect(row).toContainText("Less ice");
  await row.getByRole("button", { name: /Show who ordered/ }).click();
  await expect(row.getByText("Miguel").first()).toBeVisible();
});

test("removing and Undo; quantity steps (scenario 7)", async ({ page }) => {
  await startOrder(page);
  await addDish(page, "Gyoza");
  await page.getByRole("button", { name: "One more Gyoza" }).click();
  await expect(page.getByTestId("dish-row")).toContainText("2");
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await page.getByRole("button", { name: "One less Gyoza" }).click();
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await page.getByRole("button", { name: "Remove Gyoza" }).click();
  await expect(page.getByTestId("dish-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("dish-row")).toHaveCount(1);
  await expect(page.getByTestId("dish-row")).toContainText("Gyoza");
  await page.reload();
  await expect(page.getByTestId("dish-row")).toContainText("Gyoza");
});

test("rapid taps on a stepper all count", async ({ page }) => {
  await startOrder(page);
  await addDish(page, "Gyoza");
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  const plus = page.getByRole("button", { name: "One more Gyoza" });
  for (let i = 0; i < 4; i++) await plus.click();
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  await page.reload();
  await expect(items(page)).toContainText("5");
});

test("a retried submission is applied once (scenario 8)", async ({ page }) => {
  await startOrder(page);
  const sessionId = page.url().split("/s/")[1];
  const status = await page.evaluate(async (id) => {
    const send = () =>
      fetch(`/api/sessions/${id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "retry-key-0001" },
        body: JSON.stringify({ dishName: "Rice", quantity: 3 }),
      }).then((r) => r.status);
    return Promise.all([send(), send(), send()]);
  }, sessionId);
  expect(status).toEqual([201, 201, 201]);
  await page.reload();
  await expect(page.getByTestId("dish-row")).toHaveCount(1);
  await expect(items(page)).toContainText("3");
});

test("strangers cannot open someone else's order: a forwarded room link only offers to join", async ({ page, browser }) => {
  await startOrder(page);
  await addDish(page, "Secret Dish");
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(page.url());
  await expect(stranger).toHaveURL(/\/j\/[A-Z0-9]{6}$/);
  await expect(stranger.getByText("Secret Dish")).toHaveCount(0);
  // Unknown and ended orders look the same: nothing there.
  const response = await stranger.goto("/s/00000000-0000-4000-8000-000000000000");
  expect(response?.status()).toBe(404);
  await expect(stranger.getByText("Wala dito.")).toBeVisible();
  await other.close();
});

test("landing and workspace have no automatically detectable accessibility violations", async ({ page }) => {
  // Measure settled colours, not mid-animation frames.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const landing = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(landing.violations).toEqual([]);
  await page.getByRole("button", { name: "Start an order" }).click();
  await expect(page).toHaveURL(/\/s\//);
  await addDish(page, "Gyoza", 2);
  const workspace = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(workspace.violations).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  // Let the theme switch paint (colour transitions settle) before measuring contrast.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const dark = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(dark.violations).toEqual([]);
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("button", { name: "Show the waiter" }).click();
  const waiter = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(waiter.violations).toEqual([]);
});
