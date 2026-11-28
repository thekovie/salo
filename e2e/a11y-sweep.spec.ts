import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { axeClean, expectNoOverflow } from "./support/a11y";
import { addDish, confirmRound1, endOrder, inviteCode, joinAsGuest, openKkb, orderFor, openDetail, startOrder } from "./support/helpers";

// App-wide a11y sweep (slice 9): every surface the per-feature specs don't axe, light and dark at 320 px.
const T = { timeout: 15_000 };
const NARROW = { width: 320, height: 640 };
const DIALOG = '[role="dialog"], dialog[open]';

async function phone(browser: Browser) {
  const context = await browser.newContext({ ...test.info().project.use });
  const page = await context.newPage();
  await page.setViewportSize(NARROW);
  await page.emulateMedia({ reducedMotion: "reduce" });
  return { context, page };
}

/** Opens a sheet from its trigger, axes it, closes it (Escape or its Close button) and expects focus back on the trigger. */
/** Keyboard activation: at 320 the sticky header and toasts cover some controls, and focus-return needs the control focused anyway. */
async function press(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Enter");
}

async function sheetCycle(page: Page, trigger: Locator, dialog: Locator, label: string, close: "escape" | "button" = "escape", include = DIALOG) {
  await press(page, trigger);
  await expect(dialog).toBeVisible(T);
  await axeClean(page, { include, label });
  if (close === "escape") await page.keyboard.press("Escape");
  else await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(dialog).toBeHidden(T);
  await expect.soft(trigger, `${label}: focus returns to its trigger`).toBeFocused({ timeout: 3_000 });
}

const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });
/** Switches tab from the top of the page: scrolled down at 320, the sticky header would otherwise sit over the tab. */
async function goTab(page: Page, name: RegExp) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await press(page, tab(page, name));
  await page.evaluate(() => window.scrollTo(0, 0)); // focusing a sticky tab can leave the content under the header, which axe reads as obscured
}
const roomId = (page: Page) => /\/s\/([0-9a-f-]{36})/.exec(page.url())![1];

test.describe("one order at 320", () => {
  test.describe.configure({ mode: "serial" }); // later tests use the guests and dishes earlier ones add
  let host: { context: BrowserContext; page: Page };
  let code: string;
  let room: string;
  const guests: BrowserContext[] = [];
  const guestPage: Record<string, Page> = {};

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    host = await phone(browser);
    await startOrder(host.page);
    room = roomId(host.page);
    code = await inviteCode(host.page);
  });
  test.afterAll(async () => {
    for (const g of guests) await g.close();
    await host.context.close();
  });

  async function join(browser: Browser, name: string) {
    const guest = await joinAsGuest(browser, code, name);
    await guest.page.setViewportSize(NARROW);
    await guest.page.emulateMedia({ reducedMotion: "reduce" });
    guests.push(guest.context);
    guestPage[name] = guest.page;
    return guest;
  }

  test("fresh order: name prompt, composer details, recipient picker, empty People and KKB, invite and options sheets", async () => {
    test.setTimeout(180_000);
    const { page } = host;
    await expect(page.getByRole("form", { name: "Your name" })).toBeVisible(T);
    await axeClean(page, { label: "host name prompt" });
    await page.getByRole("form", { name: "Your name" }).getByRole("button", { name: "Later" }).click();

    await page.getByRole("textbox", { name: "Dish" }).focus();
    await openDetail(page, "Size");
    await axeClean(page, { label: "composer details (size open)" });
    await openDetail(page, "Price");
    await axeClean(page, { label: "composer details (price open)" });
    await orderFor(page, "A person", "Ana");
    await axeClean(page, { label: "recipient picker, new person" });
    await orderFor(page, "Me");
    await page.getByRole("textbox", { name: "Dish" }).press("Escape");

    await sheetCycle(page, page.getByRole("button", { name: "Invite" }), page.getByRole("dialog", { name: "Invite the table" }), "invite sheet");
    await sheetCycle(page, page.getByRole("button", { name: "Invite" }), page.getByRole("dialog", { name: "Invite the table" }), "invite sheet (Close button)", "button");
    await sheetCycle(page, page.getByRole("button", { name: "Order options" }), page.getByRole("dialog", { name: "Order options" }), "order options sheet");

    await goTab(page, /People/);
    await axeClean(page, { label: "empty People" });
    await goTab(page, /Order/);
  });

  test("invite page as a stranger, its name form, the removed notice, the 404 and the landing resume list", async ({ browser }) => {
    test.setTimeout(180_000);
    const stranger = await phone(browser);
    await stranger.page.goto(`/i/${code}`);
    await expect(stranger.page.getByLabel("Your name")).toBeVisible(T);
    await axeClean(stranger.page, { label: "invite page, stranger" });
    await stranger.page.getByRole("button", { name: "Join the order" }).click();
    await expect(stranger.page.getByRole("alert").filter({ hasNotText: /^$/ }).first()).toBeVisible(T);
    await axeClean(stranger.page, { label: "invite page, name form with error" });
    await stranger.page.goto("/this-page-does-not-exist");
    await expect(stranger.page.getByRole("heading", { name: "Wala dito." })).toBeVisible(T);
    await axeClean(stranger.page, { label: "404" });
    await stranger.context.close();

    await host.page.goto("/");
    await expect(host.page.getByRole("heading", { name: "Pick up where you left off" })).toBeVisible(T);
    await axeClean(host.page, { label: "landing with resume list" });
    await host.page.goto(`/s/${room}`);
  });

  test("Order with guests: edit sheet, Groups, People, remove-guest sheet and the removed notice", async ({ browser }) => {
    test.setTimeout(180_000);
    const { page } = host;
    const jd = await join(browser, "JD");
    const pat = await join(browser, "Pat");
    await addDish(page, "Chicken Katsu");
    await addDish(jd.page, "Iced Tea");
    await addDish(pat.page, "Rice");
    await expect(page.getByTestId("dish-row").filter({ hasText: "Rice" })).toBeVisible(T);
    await orderFor(page, "A group", "Barkada");
    await addDish(page, "Gyoza");
    await orderFor(page, "Me");
    await axeClean(page, { label: "Order tab with dishes" });

    await sheetCycle(page, page.getByRole("button", { name: "Edit Chicken Katsu" }), page.getByRole("dialog", { name: "Edit Chicken Katsu" }), "edit dish sheet");
    await sheetCycle(page, page.getByRole("button", { name: "Edit Chicken Katsu" }), page.getByRole("dialog", { name: "Edit Chicken Katsu" }), "edit dish sheet (Close button)", "button");

    await goTab(page, /Groups/);
    await axeClean(page, { label: "Groups" });
    await sheetCycle(page, page.getByRole("button", { name: "Add members" }), page.getByRole("dialog", { name: /Who’s in Barkada/ }), "group members sheet");
    await goTab(page, /People/);
    await axeClean(page, { label: "People with guests" });
    // Nothing confirmed yet: Items and KKB are empty.
    await sheetCycle(page, page.getByRole("button", { name: "Who ordered what" }), page.getByRole("dialog", { name: "Who ordered what" }), "empty summary (Items)");
    await press(page, page.getByRole("button", { name: "Who ordered what" }));
    await page.getByRole("dialog", { name: "Who ordered what" }).getByRole("tab", { name: "KKB" }).click();
    await axeClean(page, { include: DIALOG, label: "empty KKB" });
    await page.keyboard.press("Escape");
    await sheetCycle(page, page.getByRole("button", { name: "Remove Pat" }), page.getByRole("dialog", { name: "Remove Pat from the order?" }), "remove-guest sheet");

    await press(page, page.getByRole("button", { name: "Remove Pat" }));
    const sheet = page.getByRole("dialog", { name: "Remove Pat from the order?" });
    await sheet.getByLabel(/Reason/).fill("Wrong table, sorry!");
    await sheet.getByRole("button", { name: "Remove Pat" }).click();
    await expect(pat.page.getByRole("heading", { name: "You’re no longer in this order" })).toBeVisible(T);
    await axeClean(pat.page, { label: "removed notice" });
    await page.getByRole("button", { name: "Undo" }).click();
    await goTab(page, /Order/);
  });

  test("offline and sync pills", async () => {
    test.setTimeout(180_000);
    const { page, context } = host;
    await expect(page.locator('[data-sync="saved"]')).toBeVisible(T);
    await context.setOffline(true);
    await expect(page.locator("[data-connection]")).toHaveAttribute("data-connection", "offline", T);
    await axeClean(page, { label: "offline pill" });
    await addDish(page, "Halo-halo");
    await expect(page.locator("[data-connection]")).toContainText("1 change waiting", T);
    await page.evaluate(() => window.scrollTo(0, 0)); // adding scrolls the list under the sticky header, which axe reads as obscured
    await axeClean(page, { label: "offline pill with a change waiting" });
    await context.setOffline(false);
    await expect(page.locator("[data-connection]")).toHaveAttribute("data-connection", "back", T);
    await axeClean(page, { label: "back online pill" });
    await expect(page.locator('[data-sync="saved"]')).toBeVisible(T);
  });

  test("Rounds, correction and unavailable sheets, notifications and the standalone waiter page", async () => {
    test.setTimeout(180_000);
    const { page } = host;
    const jd = guestPage.JD;
    await confirmRound1(page);
    await goTab(page, /Rounds/);
    await axeClean(page, { label: "Rounds" });

    const change = page.getByRole("button", { name: /Change a dish/ });
    await sheetCycle(page, change, page.getByRole("dialog", { name: "Change a dish" }), "dish picker");
    await press(page, change);
    await page.getByRole("dialog", { name: "Change a dish" }).getByRole("button", { name: /Iced Tea/ }).click();
    const sheet = page.getByRole("dialog", { name: /Change Iced Tea/ });
    await expect(sheet).toBeVisible(T);
    await axeClean(page, { include: DIALOG, label: "correction sheet" });
    await sheet.getByRole("radio", { name: "Unavailable" }).click();
    await axeClean(page, { include: DIALOG, label: "unavailable sheet" });
    await sheet.getByRole("button", { name: "Mark unavailable" }).click();
    const confirm = page.getByRole("dialog", { name: "Mark Iced Tea unavailable?" });
    await expect(confirm).toBeVisible(T);
    await axeClean(page, { include: "dialog[open]", label: "unavailable confirm" });
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden(T);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden(T);
    await expect(change, "correction sheet: focus returns to its trigger").toBeFocused(T);

    await expect(jd.getByRole("button", { name: /^Updates, \d+ unread/ })).toBeVisible(T);
    await sheetCycle(jd, jd.getByRole("button", { name: /^Updates/ }), jd.getByRole("dialog", { name: "Updates" }), "notifications drawer", "button");
    await sheetCycle(jd, jd.getByRole("button", { name: /^Updates/ }), jd.getByRole("dialog", { name: "Updates" }), "notifications drawer (Escape)");

    await page.goto(`/s/${room}/waiter`);
    await expect(page.getByRole("link", { name: "Back to order" })).toBeVisible(T);
    await axeClean(page, { label: "standalone waiter page" });
    await page.goto(`/s/${room}`);
  });

  test("Items and KKB tabs with prices, then the ended order", async () => {
    test.setTimeout(180_000);
    const { page } = host;
    await openKkb(page);
    const sheet = page.getByRole("dialog", { name: "Who ordered what" });
    for (const [dish, amount] of [["Chicken Katsu", "120"], ["Iced Tea", "60"]]) {
      await sheet.getByRole("button", { name: `Add price, ${dish}` }).click();
      const form = sheet.getByRole("form", { name: `Price for ${dish}` });
      await form.getByLabel("Price each (₱)").fill(amount);
      await Promise.all([form.getByRole("button", { name: "Save" }).click(), expect(form).toBeHidden(T)]);
    }
    await axeClean(page, { include: DIALOG, label: "KKB with prices" });
    await sheet.getByRole("tab", { name: "Items" }).click();
    await axeClean(page, { include: DIALOG, label: "summary Items tab" });
    await page.keyboard.press("Escape");
    await expect.soft(page.getByRole("button", { name: "Who ordered what" }), "summary: focus returns to its trigger").toBeFocused(T);

    await press(page, page.getByRole("button", { name: "Order options" }));
    await press(page, page.getByRole("button", { name: "End order" }));
    const confirm = page.getByRole("dialog", { name: "End this order?" });
    await axeClean(page, { include: DIALOG, label: "End confirm" });
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden(T);
    await page.keyboard.press("Escape");
    await endOrder(page);
    await axeClean(page, { label: "host ended state" });
  });
});

test("fix-payment sheet", async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await phone(browser);
  const { page } = host;
  await startOrder(page);
  const ana = await joinAsGuest(browser, await inviteCode(page), "Ana");
  await addDish(ana.page, "Rice");
  await orderFor(page, "A person", "Ana");
  await addDish(page, "Soup");

  // A payment the host recorded to a typed "Ana", then Ana claims that name: it needs review (as payments.spec.ts does it).
  const sid = roomId(page);
  const origin = new URL(page.url()).origin;
  const headers = () => ({ origin, "idempotency-key": crypto.randomUUID() });
  const sync = (await (await page.request.get(`/api/sessions/${sid}/sync`)).json()) as { data: { participants: { id: string; displayName: string }[] } };
  const anaId = sync.data.participants.find((p) => p.displayName === "Ana")!.id;
  const paid = await page.request.put(`/api/sessions/${sid}/payments/${crypto.randomUUID()}`, { headers: headers(), data: { payer: { participantId: anaId }, payee: { label: "Ana" }, amountCentavos: 10000, method: "gcash", note: null } });
  expect(paid.status()).toBe(200);
  await ana.page.getByRole("tab", { name: /People/ }).click();
  await ana.page.locator("section", { hasText: "The host added these for" }).getByRole("listitem").filter({ hasText: "Soup" }).getByRole("button", { name: "That’s mine" }).click();
  await goTab(page, /People/);
  await page.getByRole("button", { name: "Approve" }).click();
  await confirmRound1(page);
  await openKkb(page);
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  for (const [dish, amount] of [["Rice", "100"], ["Soup", "200"]]) {
    await sheet.getByRole("button", { name: `Add price, ${dish}` }).click();
    const form = sheet.getByRole("form", { name: `Price for ${dish}` });
    await form.getByLabel("Price each (₱)").fill(amount);
    await Promise.all([form.getByRole("button", { name: "Save" }).click(), expect(form).toBeHidden(T)]);
  }
  await sheet.locator("details").filter({ hasText: "Ana" }).first().evaluate((d: HTMLDetailsElement) => (d.open = true));
  await expect(sheet.getByText("Needs review")).toBeVisible(T);
  await sheetCycle(page, sheet.getByRole("button", { name: /^Fix ₱100.00 payment/ }), page.getByRole("dialog", { name: "Fix payment" }), "fix-payment sheet");
  await ana.context.close();
  await host.context.close();
});

test.describe("no sideways scroll", () => {
  const WIDTHS = [320, 768, 1280];
  const LONG_DISH = "Sisig".repeat(12); // 60 characters, no space: the dish-name limit
  const LONG_NAME = "Maximilian".repeat(4); // 40 characters: the name limit

  test("landing, Order, People, KKB and the ended order hold 320, 768 and 1280 with the longest names", async ({ browser }) => {
    test.setTimeout(300_000);
    const { context, page } = await phone(browser);
    await page.setViewportSize(test.info().project.use.viewport!); // set up at the phone's own size; `at` below narrows and widens it
    await startOrder(page);
    const room = page.url();
    const guest = await joinAsGuest(browser, await inviteCode(page), LONG_NAME);
    await addDish(page, LONG_DISH);
    await addDish(guest.page, LONG_DISH);
    await expect(page.getByTestId("dish-row")).toHaveCount(1, T);
    await expect(page.locator(".arrival-pill")).toHaveCount(0, T); // the guest's arrival toast covers the dock
    await confirmRound1(page);

    const at = async (width: number, what: string, check: () => Promise<void>) => {
      await page.setViewportSize({ width, height: 800 });
      await check();
      await expectNoOverflow(page, `${what} at ${width}`);
    };
    for (const width of WIDTHS) {
      await at(width, "landing", async () => {
        await page.goto("/");
        await expect(page.getByRole("link", { name: "Start an order" }).first()).toBeVisible(T);
      });
      await at(width, "Order", async () => {
        await page.goto(room);
        await expect(tab(page, /Order/)).toBeVisible(T);
      });
      await at(width, "People", () => tab(page, /People/).click());
      await at(width, "KKB", async () => {
        await openKkb(page);
      });
      await expect(page.getByRole("dialog", { name: "Who ordered what" })).toBeVisible(T);
      await page.keyboard.press("Escape");
    }

    await page.goto(room);
    await endOrder(page);
    for (const width of WIDTHS) await at(width, "ended order", async () => void (await page.goto(room)));
    await guest.context.close();
    await context.close();
  });
});
