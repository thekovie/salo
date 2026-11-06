import { expect, test } from "@playwright/test";
import { startOrder } from "./support/helpers";

// Brief 6.7: everything common works from a keyboard (also how switch and screen-reader users drive a page).
test("keyboard only: add dishes, step quantities, switch views, open and close dialogs", async ({ page }) => {
  await startOrder(page);
  const dish = page.getByRole("textbox", { name: "Dish" });
  await dish.focus();
  await page.keyboard.type("Gyoza");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dish-row")).toContainText("Gyoza");
  // Focus returns to the dish field for the next one.
  await expect(dish).toBeFocused();
  await page.keyboard.type("Iced Tea");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dish-row")).toHaveCount(2);

  // Steppers are buttons: Tab to them and press Space (they wait until the new dish is saved).
  await expect(page.getByText("Saved")).toBeVisible();
  await page.getByRole("button", { name: "One more Gyoza" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("dish-row").first()).toContainText("2");

  // Tabs follow the WAI-ARIA pattern: arrows move, Home/End jump.
  await page.getByRole("tab", { name: /Order/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /People/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: /Rounds/ })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: /Order/ })).toHaveAttribute("aria-selected", "true");

  // Invite dialog: Enter opens it, focus moves inside, Escape closes it and returns focus.
  const invite = page.getByRole("button", { name: "Invite" });
  await invite.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Invite the table" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(invite).toBeFocused();

  // Review is a modal: Escape takes you back.
  await page.getByRole("button", { name: "Review order" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Review round 1" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Review round 1" })).toHaveCount(0);
});
