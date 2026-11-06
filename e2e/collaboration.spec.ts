import { expect, test } from "@playwright/test";
import { addDish, inviteCode, orderFor, startOrder } from "./support/helpers";
import type { Browser } from "@playwright/test";

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
  await expect(page.getByTestId("dish-row").filter({ hasText: "Iced Tea" })).toBeVisible();
  await page.getByRole("button", { name: /Show who ordered Chicken Katsu/ }).click();
  await expect(page.getByText("Rafa").first()).toBeVisible();

  // Guests cannot rename the order or change the host's dish.
  await expect(guest.page.getByRole("button", { name: "Order options" })).toHaveCount(0);
  await guest.page.getByRole("button", { name: /Show who ordered Chicken Katsu/ }).click();
  await expect(guest.page.getByRole("button", { name: /One more Chicken Katsu/ })).toHaveCount(1);
  await guest.context.close();
});

test("network recovery: changes made while offline elsewhere arrive after reconnecting (scenario 12)", async ({ page, browser, context }) => {
  await startOrder(page);
  const code = await inviteCode(page);
  const guest = await joinAsGuest(browser, code, "JD");
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();

  await context.setOffline(true);
  await addDish(guest.page, "Gyoza", 3);
  await expect(guest.page.locator('[data-sync="saved"]')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByTestId("dish-row").filter({ hasText: "Gyoza" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("round-total")).toContainText("3");

  // The guest's own queued change survives their connection dropping too.
  await guest.context.setOffline(true);
  await addDish(guest.page, "Rice");
  await expect(guest.page.getByText("Offline · not saved yet")).toBeVisible();
  await guest.context.setOffline(false);
  await expect(page.getByTestId("dish-row").filter({ hasText: "Rice" })).toBeVisible({ timeout: 20_000 });
  await guest.context.close();
});

test("invite link preview names the order but never its dishes or people", async ({ page, request }) => {
  await startOrder(page);
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByLabel("Order name").fill("Ramen Nagi");
  await page.getByLabel("Order name").press("Enter");
  await expect(page.getByRole("dialog", { name: "Order options" })).toHaveCount(0);
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
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

  // Preview crawlers that honour robots.txt must be allowed to fetch invites; noindex keeps them out of search.
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).not.toMatch(/Disallow: \/(j|s)\//);
  // A forwarded room link (no cookie: a friend or a crawler) lands on the invite, preview and all.
  const room = await request.get(new URL(page.url()).pathname);
  expect(room.url()).toContain(`/j/${code}`);
  expect(await room.text()).toContain('content="Join the order at Ramen Nagi"');
});

test("the host can cancel an order nothing was confirmed for; guests see it cancelled", async ({ page, browser }) => {
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(guest.page, "Gyoza");
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: "Cancel order" }).click();
  await page.getByRole("dialog", { name: "Cancel this order?" }).getByRole("button", { name: "Yes, cancel the order" }).click();
  await expect(page.getByText(/This order was cancelled/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Order options" })).toHaveCount(0);
  await expect(guest.page.getByText(/This order was cancelled/)).toBeVisible({ timeout: 10_000 });
  await expect(guest.page.getByRole("form", { name: "Add a dish" })).toHaveCount(0);
  await guest.context.close();
});

test("unknown codes and strangers get nothing", async ({ request }) => {
  expect((await request.get("/j/ZZZZZZ")).status()).toBe(404);
  expect((await request.get("/api/sessions/00000000-0000-4000-8000-000000000000/events")).status()).toBe(404);
});

test("the host orders for themselves by default and picks a guest with one tap", async ({ page, browser }) => {
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Sisig");
  await orderFor(page, "JD");
  await addDish(page, "Halo-halo");
  await page.getByRole("tab", { name: /People/ }).click();
  const hostCard = page.getByRole("tabpanel").locator("section", { has: page.getByRole("heading", { name: /host/ }) });
  await expect(hostCard).toContainText("Sisig");
  const jdCard = page.getByRole("tabpanel").locator("section", { has: page.getByRole("heading", { name: /^JD/ }) });
  await expect(jdCard).toContainText("Halo-halo");
  await guest.context.close();
});

test("someone else's new dish shows as a live pill and tags its row", async ({ page, browser }) => {
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(guest.page, "Gyoza", 2);
  await expect(page.getByRole("status").filter({ hasText: "JD added Gyoza ×2" })).toBeVisible();
  await expect(page.getByTestId("dish-row").filter({ hasText: "Gyoza" })).toContainText("+2 · JD");
  // Never for your own dish.
  await expect(guest.page.getByText("JD added Gyoza ×2")).toHaveCount(0);
  await guest.context.close();
});

test("the host removes a guest with a reason; the guest sees it and can join again; Undo restores", async ({ page, browser }) => {
  await startOrder(page);
  const code = await inviteCode(page);
  const guest = await joinAsGuest(browser, code, "JD");
  await addDish(guest.page, "Gyoza", 2);
  await expect(page.getByTestId("round-total")).toContainText("2");

  await page.getByRole("tab", { name: /People/ }).click();
  await page.getByRole("button", { name: "Remove JD" }).click();
  const sheet = page.getByRole("dialog", { name: "Remove JD from the order?" });
  await expect(sheet).toContainText("The 2 items they added in round 1 come off the ticket.");
  await sheet.getByLabel(/Reason/).fill("Wrong table, sorry!");
  await sheet.getByRole("button", { name: "Remove JD" }).click();
  await expect(page.getByTestId("round-total")).toContainText("0");

  // The guest's screen explains, with the host's note, and offers the way back.
  await expect(guest.page.getByRole("heading", { name: "You’re no longer in this order" })).toBeVisible({ timeout: 10_000 });
  await expect(guest.page.getByText("Wrong table, sorry!")).toBeVisible();
  await expect(guest.page.getByRole("link", { name: "Join again" })).toHaveAttribute("href", `/j/${code}`);

  // Undo on the host's toast brings JD and the dishes back.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("round-total")).toContainText("2");
  await guest.context.close();
});

test("times on the landing page are in the device's time zone", async ({ browser }) => {
  const context = await browser.newContext({ ...test.info().project.use, timezoneId: "America/New_York" });
  const page = await context.newPage();
  await startOrder(page);
  await page.goto("/");
  const time = page.locator("section[aria-labelledby=resume] time").first();
  // Formatted by the browser in its own zone (New York here), whatever zone the server runs in.
  const clock = await time.evaluate((el) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(el.getAttribute("datetime") ?? "")));
  await expect(time).toHaveText(new RegExp(`^(Today|Yesterday) ${clock.replace(/\s/g, "\\s")}$`));
  await context.close();
});
