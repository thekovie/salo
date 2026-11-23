import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

export async function startOrder(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Start an order" }).click();
  // Through the bot check (/new): Cloudflare's widget can take a few seconds to answer.
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/, { timeout: 20_000 });
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
  await page.getByRole("button", { name: "Review order" }).click();
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
