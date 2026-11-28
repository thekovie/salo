import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

const ROOM = /\/s\/[0-9a-f-]{36}$/;
// Next also keeps a role=alert route announcer on every page; the bot check's alert is inside /new's <main>, and the room's own (empty) alerts are not it.
const BOT_ALERT = 'main [role="alert"]';

/**
 * Starts an order through /new's real Cloudflare widget (test keys). A stuck check shows a role=alert: attach it,
 * press Try again once, and fail on a second one. Neither a room nor an alert in 20 s fails with the page state.
 */
export async function startOrder(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Start an order" }).click();
  const alert = page.locator(BOT_ALERT).filter({ hasText: /\S/ });
  for (const attempt of [1, 2]) {
    const room = page.waitForURL(ROOM, { timeout: 20_000 }).then(() => "room" as const);
    const shown = alert.first().waitFor({ state: "visible", timeout: 20_000 }).then(() => "alert" as const);
    for (const loser of [room, shown]) loser.catch(() => undefined); // the race loser times out later, unobserved
    const outcome = await Promise.race([room, shown]).catch(async () => {
      const main = await page.locator("main").innerText({ timeout: 2_000 }).catch(() => "(no main)");
      const status = await page.locator('[role="status"]').allInnerTexts().catch(() => []);
      throw new Error(`startOrder: no room and no alert in 20 s. url=${page.url()} main=${JSON.stringify(main)} status=${JSON.stringify(status)}`);
    });
    if (outcome === "room") return;
    const text = await alert.first().innerText();
    await test.info().attach(`bot-check-alert-${attempt}`, { body: text, contentType: "text/plain" });
    await test.info().attach(`bot-check-alert-${attempt}.png`, { body: await page.screenshot(), contentType: "image/png" });
    if (attempt === 2) throw new Error(`startOrder: the bot check failed twice: ${text}`);
    await page.getByRole("button", { name: "Try again" }).click();
  }
}

export async function addDish(page: Page, name: string, quantity = 1) {
  const dish = page.getByRole("textbox", { name: "Dish" });
  await dish.fill(name);
  for (let i = 1; i < quantity; i++) await page.getByRole("button", { name: "One more this dish" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dish).toHaveValue("");
  // Focus returns to the Dish after Add, which hides the bottom bar; Escape is the keyboard way back to it.
  await dish.press("Escape");
}

const CHIP: Record<string, string> = { "A person": "+ Someone else", "A group": "+ New group" };

/** Opens "who's it for" (the For button) if needed and picks a chip; "A person"/"A group" type a new name. */
export async function orderFor(page: Page, kind: "Me" | "Anyone" | "Whole table" | "A person" | "A group" | (string & {}), name?: string) {
  const toggle = page.getByRole("button", { name: /^For / });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByRole("radio", { name: CHIP[kind] ?? kind, exact: true }).click();
  if (name) await page.getByLabel(kind === "A group" ? "Group name" : "Person's name").fill(name);
}

const DETAIL_CHIP = { Size: "Size", Note: "Note", Price: "₱ Price" } as const;

/** Opens one detail field (Size, Note or Price) with its chip under the dish; one field is open at a time. */
export async function openDetail(page: Page | Locator, which: keyof typeof DETAIL_CHIP) {
  // Closed chips read "+ Size"; the open one reads "Size" with a close icon.
  const open = page.getByRole("button", { name: DETAIL_CHIP[which], exact: true, expanded: true });
  const closed = page.getByRole("button", { name: `+ ${DETAIL_CHIP[which]}`, exact: true });
  // Under 360 px the chips sit behind "+ Details"; the composer shows neither until focus is in it.
  const toggle = page.getByRole("button", { name: /^Details(, \d+ added)?$/ });
  if ((await toggle.count()) === 0 && (await closed.count()) === 0 && (await open.count()) === 0) await page.getByRole("textbox", { name: "Dish" }).focus();
  if ((await toggle.count()) > 0 && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  if ((await open.count()) === 0) await closed.click();
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
  await page.goto(`/i/${code}`);
  await expect(page.getByText(/^Live · \d+ (person|people) · \d+ items? so far$/)).toBeVisible();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join the order" }).click();
  await expect(page.getByText(/You’re in!/)).toBeVisible();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/);
  return { context, page };
}

export async function confirmRound1(page: Page) {
  await expect(page.locator('[data-sync="saved"]')).toBeVisible();
  // Keyboard: an arrival toast can sit over the dock, and a click would land on it.
  await page.getByRole("button", { name: "Review order" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Review round 1" }).getByRole("button", { name: "Show the waiter" }).click();
  const waiter = page.getByRole("dialog", { name: "Waiter ticket" });
  await waiter.getByRole("button", { name: "Mark confirmed with waiter" }).click();
  await page.getByRole("dialog", { name: /Confirm round 1/ }).getByRole("button", { name: "Yes, the waiter has it" }).click();
  await expect(waiter.getByRole("region", { name: "Round 1, confirmed with the waiter" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Back" }).click();
}

/** Opens "Who ordered what" on its KKB tab through People (the dock now leads the host to the Prices sheet). */
export async function openKkb(page: Page) {
  await page.getByRole("tab", { name: /People/ }).click();
  await page.getByRole("button", { name: "Who ordered what" }).click();
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await sheet.getByRole("tab", { name: "KKB" }).click();
  await expect(sheet.getByRole("tab", { name: "KKB" })).toHaveAttribute("aria-selected", "true");
}

/** Ends the order from Order options and closes the summary sheet that opens. */
export async function endOrder(page: Page) {
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: "End order" }).click();
  await page.getByRole("dialog", { name: "End this order?" }).getByRole("button", { name: "Yes, end the order" }).click();
  await expect(page.getByRole("dialog", { name: "Who ordered what" })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
}
