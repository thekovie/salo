import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

const items = (page: Page) => page.getByText(/items? this round/);

test("host-only ordering: start, add dishes, consolidate, waiter ticket (scenarios 1, 5, 9)", async ({ page }) => {
  await startOrder(page);
  await addDish(page, "Chicken Katsu", 2);
  await addDish(page, "chicken katsu");
  await addDish(page, "Chicken Cutlet");
  await expect(page.getByText("Saved")).toBeVisible();

  const rows = page.getByTestId("dish-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Chicken Katsu");
  await expect(rows.first()).toContainText("×3");
  await expect(items(page)).toContainText("4");

  // Suggestions offer dishes already in this order.
  await page.getByRole("textbox", { name: "Dish" }).fill("chick");
  await expect(page.getByRole("button", { name: "Chicken Katsu", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Dish" }).fill("");

  await page.getByRole("link", { name: "Show waiter" }).click();
  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await expect(page.getByRole("main").getByText(/^\s*4 items\s*$/).last()).toBeVisible();
  await page.getByRole("link", { name: "Back to order" }).click();
  await expect(rows).toHaveCount(2);
});

test("variants and instructions stay distinct; recipient is kept between entries (scenario 6)", async ({ page }) => {
  await startOrder(page);
  await page.getByRole("button", { name: /Details/ }).click();
  await page.getByRole("radio", { name: "A person" }).click();
  await page.getByLabel("Person's name").fill("Miguel");
  await page.getByRole("textbox", { name: "Size or variant" }).fill("Large");
  await addDish(page, "Iced Tea");
  // Size resets, recipient stays.
  await expect(page.getByRole("textbox", { name: "Size or variant" })).toHaveValue("");
  await expect(page.getByLabel("Person's name")).toHaveValue("Miguel");
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
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "One less Gyoza" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "Remove Gyoza" }).click();
  await expect(page.getByTestId("dish-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("dish-row")).toHaveCount(1);
  await expect(page.getByTestId("dish-row")).toContainText("Gyoza");
  await page.reload();
  await expect(page.getByTestId("dish-row")).toContainText("Gyoza");
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

test("strangers cannot open someone else's order", async ({ page, browser }) => {
  await startOrder(page);
  const other = await browser.newContext();
  const stranger = await other.newPage();
  const response = await stranger.goto(page.url());
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
  const dark = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(dark.violations).toEqual([]);
  await page.getByRole("link", { name: "Show waiter" }).click();
  const waiter = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(waiter.violations).toEqual([]);
});
