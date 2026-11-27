import { expect, test } from "@playwright/test";
import { addDish, confirmRound1, endOrder, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };

test("a member opening their ended order's invite lands on the order; a stranger gets the 404", async ({ page, browser }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const code = await inviteCode(page);
  const guest = await joinAsGuest(browser, code, "Jun");
  await addDish(page, "Sisig");
  await confirmRound1(page);
  await endOrder(page);

  await guest.page.goto(`/i/${code}`);
  await expect(guest.page).toHaveURL(/\/s\/[0-9a-f-]{36}$/, T);
  await expect(guest.page.getByText("This order has ended")).toBeVisible(T);
  await page.goto(`/i/${code}`);
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/, T);

  const stranger = await browser.newContext({ ...test.info().project.use });
  const strangerPage = await stranger.newPage();
  const response = await strangerPage.goto(`/i/${code}`);
  expect(response?.status()).toBe(404);
  await expect(strangerPage.getByRole("heading", { name: "Wala dito." })).toBeVisible(T);
  await stranger.close();
  await guest.context.close();
});

test("joining a second order leaves the first untouched; both are on the landing page", async ({ page, browser }) => {
  test.slow();
  await startOrder(page);
  const codeA = await inviteCode(page);
  const idA = new URL(page.url()).pathname.split("/").pop();
  const guest = await joinAsGuest(browser, codeA, "Jun");

  const hostB = await browser.newContext({ ...test.info().project.use });
  const pageB = await hostB.newPage();
  await startOrder(pageB);
  const codeB = await inviteCode(pageB);

  await guest.page.goto(`/i/${codeB}`);
  await guest.page.getByLabel("Your name").fill("Jun");
  await Promise.all([guest.page.waitForResponse((r) => r.url().includes("/join") && r.ok(), T), guest.page.getByRole("button", { name: "Join the order" }).click()]);
  await expect(guest.page).toHaveURL(/\/s\/[0-9a-f-]{36}/, T);

  await guest.page.goto("/");
  const resume = guest.page.getByRole("region", { name: "Pick up where you left off" });
  await expect(resume.getByRole("listitem")).toHaveCount(2, T);
  await expect(resume.locator(`a[href="/s/${idA}"]`)).toBeVisible();
  await guest.page.goto(`/i/${codeA}`);
  await expect(guest.page).toHaveURL(`/s/${idA}`, T);
  await hostB.close();
  await guest.context.close();
});

test("joining offline says what really happens and keeps the name", async ({ page, browser }) => {
  await startOrder(page);
  const code = await inviteCode(page);
  const context = await browser.newContext({ ...test.info().project.use });
  const guest = await context.newPage();
  await guest.goto(`/i/${code}`);
  await guest.getByLabel("Your name").fill("Rafa");
  await context.setOffline(true);
  await guest.getByRole("button", { name: "Join the order" }).click();
  await expect(guest.getByRole("alert").filter({ hasText: "No connection." })).toHaveText("No connection. Your name is still here; try again when you’re back online.", T);
  await expect(guest.getByLabel("Your name")).toHaveValue("Rafa");
  await expect(guest.getByRole("button", { name: "Join the order" })).toBeEnabled(T);
  await context.setOffline(false);
  await Promise.all([guest.waitForResponse((r) => r.url().includes("/join") && r.ok(), T), guest.getByRole("button", { name: "Join the order" }).click()]);
  await expect(guest).toHaveURL(/\/s\/[0-9a-f-]{36}/, T);
  await context.close();
});

test("the invite page shows the code for Home Screen users, hidden in the installed app", async ({ page, browser }) => {
  await startOrder(page);
  const code = await inviteCode(page);
  const context = await browser.newContext({ ...test.info().project.use });
  const guest = await context.newPage();
  await guest.goto(`/i/${code}`);
  const hint = guest.getByTestId("home-screen-hint");
  await expect(hint).toContainText("Using Salo from your Home Screen? Open it and enter");
  await expect(hint).toContainText(code);
  // Playwright can't emulate display-mode, so check the rule that hides it.
  await expect(hint).toHaveClass(/display-mode:standalone/);
  await context.close();
});

test("the manifest has an id, scope and launch handler", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ id: "/", scope: "/", launch_handler: { client_mode: "navigate-existing" } });
});
