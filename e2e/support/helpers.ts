import { expect, test, type Browser, type Page } from "@playwright/test";

export async function startOrder(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start an order" }).click();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/);
}

export async function addDish(page: Page, name: string, quantity = 1) {
  const dish = page.getByRole("textbox", { name: "Dish" });
  await dish.fill(name);
  for (let i = 1; i < quantity; i++) await page.getByRole("button", { name: "One more this dish" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dish).toHaveValue("");
}

/** Opens Details and picks who the next dishes are for. */
export async function orderFor(page: Page, kind: "Me" | "Anyone" | "Whole table" | "A person" | "A group", name?: string) {
  const details = page.getByRole("button", { name: /details/i });
  if ((await details.getAttribute("aria-expanded")) !== "true") await details.click();
  await page.getByRole("radio", { name: kind }).click();
  if (name) await page.getByLabel(kind === "A group" ? "Group name" : "Person's name").fill(name);
}

export async function inviteCode(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite the table" });
  await expect(dialog.getByRole("img", { name: /QR code to join/ })).toBeVisible();
  const code = ((await dialog.getByText(/^Code /).textContent()) ?? "").replace(/^Code /, "").replace(/\s/g, "");
  await dialog.getByRole("button", { name: "Close" }).click();
  return code;
}

export async function joinAsGuest(browser: Browser, code: string, name: string) {
  const context = await browser.newContext({ ...test.info().project.use });
  const page = await context.newPage();
  await page.goto(`/j/${code}`);
  await expect(page.getByText(/^Live · \d+ (person|people) · \d+ items? so far$/)).toBeVisible();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join the order" }).click();
  await expect(page.getByText(/You’re in!/)).toBeVisible();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/);
  return { context, page };
}
