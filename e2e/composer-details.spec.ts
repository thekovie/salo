import { expect, test } from "@playwright/test";
import { addDish, startOrder } from "./support/helpers";

test("size, note and price from the chips: four taps after the name, and the line shows them", async ({ page }) => {
  await startOrder(page);
  await page.getByRole("textbox", { name: "Dish" }).fill("Chicken Katsu");

  await page.getByRole("button", { name: "+ Size", exact: true }).click(); // tap 1
  await page.getByRole("textbox", { name: "Size or variant" }).fill("Large");
  await page.getByRole("button", { name: "+ Note", exact: true }).click(); // tap 2
  await expect(page.getByRole("textbox", { name: "Size or variant" })).toBeHidden(); // one field at a time
  await page.getByRole("textbox", { name: "Instructions" }).fill("No sauce");
  await page.getByRole("button", { name: "+ ₱ Price", exact: true }).click(); // tap 3
  await page.getByLabel("Price each (₱)").fill("120");

  // Filled fields wait as tags before Add; ✕ names what it removes.
  await expect(page.getByRole("button", { name: "Remove size Large" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove note No sauce" })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click(); // tap 4

  const row = page.getByTestId("dish-row");
  await expect(row).toContainText("Chicken Katsu");
  await expect(row).toContainText("Large");
  await expect(row).toContainText("No sauce");
  await expect(page.getByRole("button", { name: "+ Size", exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("a tag reopens its field and its ✕ clears it; sizes used in this order are suggested", async ({ page }) => {
  await startOrder(page);
  await page.getByRole("textbox", { name: "Dish" }).fill("Gyoza");
  await page.getByRole("button", { name: "+ Size", exact: true }).click();
  await page.getByRole("textbox", { name: "Size or variant" }).fill("Large");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Dish" })).toHaveValue("");

  await page.getByRole("textbox", { name: "Dish" }).fill("gyoza");
  await page.getByRole("button", { name: "+ Size", exact: true }).click();
  await page.getByRole("group", { name: "Sizes used in this order" }).getByRole("button", { name: "Large" }).click();
  await expect(page.getByRole("textbox", { name: "Size or variant" })).toHaveValue("Large");
  await page.getByRole("button", { name: "+ Note", exact: true }).click();
  await page.getByRole("button", { name: "Large, size. Edit" }).click();
  await expect(page.getByRole("textbox", { name: "Size or variant" })).toBeFocused();
  await page.getByRole("button", { name: "+ Note", exact: true }).click();
  await page.getByRole("button", { name: "Remove size Large" }).click();
  await expect(page.getByRole("button", { name: "+ Size", exact: true })).toBeVisible();
});

test("a comma offers a split; Split fills size, Keep as typed saves the name unchanged", async ({ page }) => {
  await startOrder(page);
  const dish = page.getByRole("textbox", { name: "Dish" });
  await dish.fill("Gyoza, large");
  await expect(page.getByText("Split into Gyoza · size “large”?")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Split into Gyoza" })).toContainText("size large");
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(dish).toHaveValue("Gyoza");
  await expect(page.getByRole("button", { name: "Remove size large" })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const row = page.getByTestId("dish-row").filter({ hasText: "Gyoza" });
  await expect(row).toContainText("large");
  await expect(row).not.toContainText("Gyoza, large");

  await dish.fill("Sisig, extra spicy");
  await page.getByRole("button", { name: "Keep as typed" }).click();
  await expect(page.getByRole("button", { name: "Split", exact: true })).toHaveCount(0);
  await addDish(page, "Sisig, extra spicy");
  await expect(page.getByTestId("dish-row").filter({ hasText: "Sisig, extra spicy" })).toBeVisible();
});
