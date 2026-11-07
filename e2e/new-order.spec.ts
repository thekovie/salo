import { expect, test } from "@playwright/test";

test("an order can only be started through the bot check", async ({ page, request }) => {
  // Straight at the API without a Turnstile token: refused.
  const origin = test.info().project.use.baseURL as string;
  const refused = await request.post("/api/sessions", { data: {}, headers: { "Idempotency-Key": crypto.randomUUID(), Origin: origin } });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error.code).toBe("BOT_CHECK_FAILED");

  // Through the page: the check passes (Cloudflare test keys) and the new order opens.
  await page.goto("/");
  await page.getByRole("link", { name: "Start an order" }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByRole("heading", { name: "One moment" })).toBeVisible();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/, { timeout: 20_000 });
});
