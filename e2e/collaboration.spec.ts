import { expect, test, type Browser, type Page } from "@playwright/test";

async function startOrder(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start an order" }).click();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/);
}

async function addDish(page: Page, name: string, quantity = 1) {
  const dish = page.getByRole("textbox", { name: "Dish" });
  await dish.fill(name);
  for (let i = 1; i < quantity; i++) await page.getByRole("button", { name: "One more this dish" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dish).toHaveValue("");
}

async function inviteCode(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite the table" });
  await expect(dialog.getByRole("img", { name: /QR code to join/ })).toBeVisible();
  const code = (await dialog.getByLabel(/^Code /).textContent())!.trim();
  await dialog.getByRole("button", { name: "Close" }).click();
  return code;
}

async function joinAsGuest(browser: Browser, code: string, name: string) {
  const context = await browser.newContext({ ...test.info().project.use });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Joining a table? Enter its code").fill(code.toLowerCase());
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Join the order" })).toBeVisible();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join the order" }).click();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/);
  return { context, page };
}

test("QR/code collaboration: guests join and every change shows up live (scenarios 2, 4)", async ({ page, browser }) => {
  await startOrder(page);
  await addDish(page, "Chicken Katsu", 2);
  const code = await inviteCode(page);
  const guest = await joinAsGuest(browser, code, "Rafa");

  // The guest sees the host's dishes and adds their own, for themselves by default.
  await expect(guest.page.getByTestId("dish-row").first()).toContainText("Chicken Katsu");
  await addDish(guest.page, "chicken katsu");
  await addDish(guest.page, "Iced Tea", 2);

  // The host sees it without reloading: consolidated with their own entry.
  await expect(page.getByTestId("dish-row").first()).toContainText("×3");
  await expect(page.getByText("Iced Tea")).toBeVisible();
  await page.getByRole("button", { name: /Show who ordered Chicken Katsu/ }).click();
  await expect(page.getByText("Rafa").first()).toBeVisible();

  // Guests cannot rename the order or change the host's dish.
  await expect(guest.page.getByRole("button", { name: /\(rename\)/ })).toHaveCount(0);
  await guest.page.getByRole("button", { name: /Show who ordered Chicken Katsu/ }).click();
  await expect(guest.page.getByRole("button", { name: /One more Chicken Katsu/ })).toHaveCount(1);
  await guest.context.close();
});

test("network recovery: changes made while offline elsewhere arrive after reconnecting (scenario 12)", async ({ page, browser, context }) => {
  await startOrder(page);
  const code = await inviteCode(page);
  const guest = await joinAsGuest(browser, code, "JD");
  await expect(page.getByText("Saved")).toBeVisible();

  await context.setOffline(true);
  await addDish(guest.page, "Gyoza", 3);
  await expect(guest.page.getByText("Saved")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("Gyoza")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/items? this round/)).toContainText("3");

  // The guest's own queued change survives their connection dropping too.
  await guest.context.setOffline(true);
  await addDish(guest.page, "Rice");
  await expect(guest.page.getByText("Offline · not saved yet")).toBeVisible();
  await guest.context.setOffline(false);
  await expect(page.getByText("Rice")).toBeVisible({ timeout: 20_000 });
  await guest.context.close();
});

test("invite link preview names the order but never its dishes or people", async ({ page, request }) => {
  await startOrder(page);
  await page.getByRole("button", { name: /rename/ }).click();
  await page.getByLabel("Order name").fill("Ramen Nagi");
  await page.getByLabel("Order name").press("Enter");
  await expect(page.getByText("Saved")).toBeVisible();
  await addDish(page, "Secret Dish");
  const code = await inviteCode(page);

  const html = await (await request.get(`/j/${code}`)).text();
  expect(html).toContain('property="og:title" content="Join the order at Ramen Nagi"');
  expect(html).toContain("og:image");
  expect(html).toContain("noindex");
  expect(html).not.toContain("Secret Dish");
  const image = await request.get(`/j/${code}/opengraph-image`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
});

test("unknown codes and strangers get nothing", async ({ request }) => {
  expect((await request.get("/j/ZZZZZZ")).status()).toBe(404);
  expect((await request.get("/api/sessions/00000000-0000-4000-8000-000000000000/events")).status()).toBe(404);
});
