import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WAIT = 15_000;
const ROOM = /\/s\/[0-9a-f-]{36}$/;

type Stub = { opts: Record<string, (token?: string) => void> | null };
declare global {
  interface Window {
    __ts: Stub;
  }
}

/** Replaces Cloudflare's script before load: stores the render options so a test can fire callbacks; reset re-runs the check. */
async function stubTurnstile(page: Page) {
  await page.addInitScript(() => {
    window.__ts = { opts: null };
    window.turnstile = {
      render: (_el, options) => {
        window.__ts.opts = options as Stub["opts"];
        return "stub";
      },
      reset: () => window.__ts.opts?.callback("XXXX.DUMMY.TOKEN.XXXX"),
      remove: () => {},
    };
  });
  await page.goto("/new");
  await page.waitForFunction(() => window.__ts.opts, null, { timeout: WAIT });
}
const fire = (page: Page, name: string) => page.evaluate((n) => window.__ts.opts?.[n]?.("XXXX.DUMMY.TOKEN.XXXX"), name);
// Next also keeps a role=alert route announcer on every page.
const alertBox = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const tryAgain = (page: Page) => page.getByRole("button", { name: "Try again" });
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

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
  await expect(page.getByRole("heading", { name: /Preparing your table|Setting up your table/ })).toBeVisible();
  await expect(page).toHaveURL(ROOM, { timeout: 20_000 });
});

for (const [callback, reason] of [
  ["error-callback", "The quick check couldn’t finish. Try again."],
  ["timeout-callback", "The check timed out. Try again."],
  ["expired-callback", "The check expired before we could use it. Try again."],
  ["unsupported-callback", "This browser can’t run the quick check. Try another browser."],
] as const) {
  test(`${callback} shows the check error, and Try again opens the order`, async ({ page }) => {
    await stubTurnstile(page);
    await expect(page.getByRole("heading", { name: "Preparing your table…" })).toBeVisible();
    await fire(page, callback);
    const alert = alertBox(page);
    await expect(alert).toContainText("Verification could not finish.", { timeout: WAIT });
    await expect(alert).toContainText(reason);
    await tryAgain(page).click();
    await expect(page).toHaveURL(ROOM, { timeout: WAIT });
  });
}

test("a stale callback after an error does not overwrite it", async ({ page }) => {
  await stubTurnstile(page);
  await fire(page, "error-callback");
  await expect(alertBox(page)).toContainText("Verification could not finish.", { timeout: WAIT });
  let posts = 0;
  page.on("request", (request) => request.method() === "POST" && request.url().endsWith("/api/sessions") && posts++);
  await fire(page, "expired-callback");
  await fire(page, "callback");
  // Let React commit any (wrong) update before asserting, or a regressed guard could still pass.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(posts).toBe(0);
  await expect(alertBox(page)).toContainText("The quick check couldn’t finish.");
  await expect(page).toHaveURL(/\/new$/);
});

test("a dropped connection says so", async ({ page }) => {
  await page.route("**/api/sessions", (route) => route.abort("connectionfailed"));
  await stubTurnstile(page);
  await fire(page, "callback");
  await expect(alertBox(page)).toContainText("Connection was lost.", { timeout: WAIT });
  await expect(alertBox(page)).toContainText("No connection. Check your data or Wi-Fi and try again.");
});

test("server refusals: 503 is a verification problem, 429 a setup problem", async ({ page }) => {
  let status = 503;
  await page.route("**/api/sessions", (route) =>
    route.fulfill(
      status === 503
        ? { status, json: { error: { code: "BOT_CHECK_UNAVAILABLE", message: "Verification is unavailable right now." } } }
        : { status, json: { error: { code: "RATE_LIMITED", message: "Too many new orders. Try again in 12 minutes." } } },
    ),
  );
  await stubTurnstile(page);
  await fire(page, "callback");
  const alert = alertBox(page);
  await expect(alert).toContainText("Verification could not finish.", { timeout: WAIT });
  await expect(alert).toContainText("Verification is unavailable right now.");
  status = 429;
  await tryAgain(page).click();
  await expect(alert).toContainText("We couldn’t set up your table.", { timeout: WAIT });
  await expect(alert).toContainText("Too many new orders. Try again in 12 minutes.");
});

test("a lost response retries into the same room with the same Idempotency-Key", async ({ page }) => {
  const keys: (string | undefined)[] = [];
  let createdId = "";
  await page.route("**/api/sessions", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length > 1) return route.continue();
    const real = await route.fetch();
    createdId = (await real.json()).data.id;
    await route.abort("connectionfailed");
  });
  await stubTurnstile(page);
  await fire(page, "callback");
  await expect(alertBox(page)).toContainText("Connection was lost.", { timeout: WAIT });
  await tryAgain(page).click();
  await expect(page).toHaveURL(ROOM, { timeout: WAIT });
  expect(page.url().endsWith(createdId)).toBe(true);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("reduced motion shows the set table", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubTurnstile(page);
  const plates = page.locator(".table-plate");
  await expect(plates).toHaveCount(6);
  for (const plate of await plates.all()) {
    await expect(plate).toHaveCSS("opacity", "1");
    await expect(plate).toHaveCSS("animation-name", "none");
  }
});

test("keyboard: Try again is the first tab stop and Enter retries", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Safari's Tab skips buttons unless the OS setting is on");
  await stubTurnstile(page);
  await fire(page, "error-callback");
  await expect(tryAgain(page)).toBeVisible({ timeout: WAIT });
  await page.keyboard.press("Tab");
  await expect(tryAgain(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(ROOM, { timeout: WAIT });
});

test("the status region changes exactly once, checking to creating", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/sessions", async (route) => {
    await held;
    await route.continue();
  });
  await stubTurnstile(page);
  await page.evaluate(() => {
    const status = document.querySelector('[role="status"]') as HTMLElement;
    const log = [status.textContent];
    (window as unknown as { __log: (string | null)[] }).__log = log;
    new MutationObserver(() => {
      if (status.textContent !== log[log.length - 1]) log.push(status.textContent);
    }).observe(status, { childList: true, subtree: true, characterData: true });
  });
  await fire(page, "callback");
  await expect(page.getByRole("heading", { name: "Setting up your table…" })).toBeVisible({ timeout: WAIT });
  const log = await page.evaluate(() => (window as unknown as { __log: string[] }).__log);
  expect(log).toHaveLength(2);
  release();
  await expect(page).toHaveURL(ROOM, { timeout: WAIT });
});

test("320 px: nothing overflows sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await stubTurnstile(page);
  const overflows = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(await overflows()).toBe(false);
  await fire(page, "error-callback");
  await expect(tryAgain(page)).toBeVisible({ timeout: WAIT });
  expect(await overflows()).toBe(false);
});

test("axe: checking and error, light and dark", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await stubTurnstile(page);
    await page.waitForTimeout(400); // let the theme colour transition settle before measuring contrast
    const checking = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(checking.violations).toEqual([]);
    await fire(page, "error-callback");
    await expect(tryAgain(page)).toBeVisible({ timeout: WAIT });
    const error = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(error.violations).toEqual([]);
  }
});
