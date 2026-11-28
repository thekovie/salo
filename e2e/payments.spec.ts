import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDish, confirmRound1, inviteCode, joinAsGuest, openKkb, orderFor, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };
const AXE = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** Jun's Rice (₱100) and Liza's Katsu (₱200), confirmed, no service charge: KKB open on the host's phone and on Jun's. */
async function scene(page: Page, browser: Parameters<typeof joinAsGuest>[0]) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const code = await inviteCode(page);
  const jun = await joinAsGuest(browser, code, "Jun");
  const liza = await joinAsGuest(browser, code, "Liza");
  await addDish(jun.page, "Rice");
  await addDish(liza.page, "Katsu");
  await expect(page.getByTestId("dish-row").filter({ hasText: "Katsu" })).toBeVisible(T);
  await confirmRound1(page);
  await openKkb(page);
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  for (const [dish, amount] of [["Rice", "100"], ["Katsu", "200"]]) {
    await sheet.getByRole("button", { name: `Add price, ${dish}` }).click();
    const form = sheet.getByRole("form", { name: `Price for ${dish}` });
    await form.getByLabel("Price each (₱)").fill(amount);
    await Promise.all([form.getByRole("button", { name: "Save" }).click(), expect(form).toBeHidden(T)]);
  }
  await sheet.getByLabel("Service charge from receipt (₱)").fill("0");
  await sheet.getByRole("region", { name: "Service charge" }).getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("No service charge on this receipt.")).toBeVisible(T);
  return { sheet, jun, liza };
}

async function record(page: Page, sheet: Locator, who: string, amount: string, method?: string) {
  await sheet.getByRole("button", { name: "Record payment" }).first().click();
  const drawer = page.getByRole("dialog", { name: `Record payment from ${who}` });
  await drawer.getByLabel(/^Amount/).fill(amount);
  if (method) await drawer.getByRole("button", { name: method, exact: true }).click();
  await Promise.all([page.waitForResponse((r) => r.url().includes("/payments/") && r.request().method() === "PUT", T), drawer.getByRole("button", { name: /^Record/ }).click()]);
  await expect(drawer).toBeHidden(T);
}

test("host records payments; the chip follows the bill and the payer sees it live", async ({ page, browser }) => {
  test.slow();
  const { sheet, jun, liza } = await scene(page, browser);
  await expect(sheet.getByText(/Unpaid|Partly paid|Paid/)).toHaveCount(0); // nothing until a payment exists

  await record(page, sheet, "Jun", "50", "GCash");
  await expect(sheet.getByText("Partly paid")).toBeVisible(T);
  await expect(sheet.getByRole("region", { name: "Payments" })).toContainText("₱50.00 of ₱300.00", T);
  await expect(sheet.getByText("Unpaid")).toBeVisible(T); // Liza

  await jun.page.getByRole("tab", { name: /People/ }).click();
  await jun.page.getByRole("button", { name: "Who ordered what" }).click();
  const junSheet = jun.page.getByRole("dialog", { name: "Who ordered what" });
  await junSheet.getByRole("tab", { name: "KKB" }).click();
  await expect(junSheet.getByText("Partly paid")).toBeVisible(T);
  await expect(junSheet.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await expect(junSheet.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  await junSheet.getByRole("button", { name: "Close" }).first().click();
  await jun.page.getByRole("button", { name: /^Updates/ }).click();
  await expect(jun.page.getByRole("dialog", { name: "Updates" })).toContainText("recorded ₱50.00 from you", T);
  await jun.page.keyboard.press("Escape");

  await record(page, sheet, "Jun", "50");
  await expect(sheet.getByText("Paid", { exact: true }).first()).toBeVisible(T);

  // A price rise makes Jun partly paid again; a drop makes the payment an overpayment.
  await sheet.getByRole("button", { name: /Edit price .*Rice/ }).click();
  const form = sheet.getByRole("form", { name: "Price for Rice" });
  await form.getByLabel("Price each (₱)").fill("150");
  await Promise.all([form.getByRole("button", { name: "Save" }).click(), expect(form).toBeHidden(T)]);
  await expect(sheet.getByText("Partly paid")).toBeVisible(T);
  await sheet.getByRole("button", { name: /Edit price .*Rice/ }).click();
  await form.getByLabel("Price each (₱)").fill("80");
  await Promise.all([form.getByRole("button", { name: "Save" }).click(), expect(form).toBeHidden(T)]);
  await expect(sheet.getByText("Overpaid")).toBeVisible(T);

  // Delete through the dialog; Jun's notice goes with it.
  await sheet.getByRole("button", { name: "Delete ₱50.00 payment from Jun" }).first().click();
  const dialog = page.getByRole("dialog", { name: /^Delete ₱/ });
  await Promise.all([page.waitForResponse((r) => r.url().includes("/payments/") && r.request().method() === "DELETE", T), dialog.getByRole("button", { name: "Delete" }).click()]);
  await expect(dialog).toBeHidden(T);
  await jun.page.getByRole("button", { name: /^Updates/ }).click();
  await expect(jun.page.getByRole("dialog", { name: "Updates" }).getByText("recorded ₱50.00 from you")).toHaveCount(1, T); // two were recorded, one deleted

  // After End the host can still record.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: "End order" }).click();
  await page.getByRole("dialog", { name: "End this order?" }).getByRole("button", { name: "Yes, end the order" }).click();
  await expect(sheet).toBeVisible(T);
  await sheet.locator("details").filter({ hasText: "Jun" }).first().evaluate((d: HTMLDetailsElement) => (d.open = true)); // cards start closed once priced
  await record(page, sheet, "Jun", "30");
  await expect(sheet.getByText("Paid", { exact: true }).first()).toBeVisible(T);
  await jun.context.close();
  await liza.context.close();
});

test("the payment drawer, the delete dialog and a card with payments pass axe in light and dark", async ({ page, browser }) => {
  test.slow();
  const { sheet, jun, liza } = await scene(page, browser);
  await record(page, sheet, "Jun", "25", "Cash");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(AXE).analyze()).violations).toEqual([]);
  }
  await sheet.getByRole("button", { name: "Record payment" }).first().click();
  await expect(page.getByRole("dialog", { name: "Record payment from Jun" })).toBeVisible(T);
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(AXE).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await sheet.getByRole("button", { name: "Delete ₱25.00 payment from Jun" }).click();
  await expect(page.getByRole("dialog", { name: /^Delete ₱/ })).toBeVisible(T);
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(AXE).analyze()).violations).toEqual([]);
  await jun.context.close();
  await liza.context.close();
});

test("a claim that leaves a payment paid to its own payer: flagged, out of the balance, host notified, fixed live", async ({ page, browser }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const ana = await joinAsGuest(browser, await inviteCode(page), "Ana");
  await addDish(ana.page, "Rice");
  await orderFor(page, "A person", "Ana");
  await addDish(page, "Soup");

  // The host recorded Ana paying a typed "Ana" (API: the drawer only offers cards with confirmed food), then Ana claims that name.
  const sid = /\/s\/([0-9a-f-]{36})/.exec(page.url())![1];
  const origin = new URL(page.url()).origin;
  const headers = () => ({ origin, "idempotency-key": crypto.randomUUID() });
  const sync = (await (await page.request.get(`/api/sessions/${sid}/sync`)).json()) as { data: { participants: { id: string; displayName: string }[] } };
  const anaId = sync.data.participants.find((p) => p.displayName === "Ana")!.id;
  const paid = await page.request.put(`/api/sessions/${sid}/payments/${crypto.randomUUID()}`, { headers: headers(), data: { payer: { participantId: anaId }, payee: { label: "Ana" }, amountCentavos: 10000, method: "gcash", note: null } });
  expect(paid.status()).toBe(200);
  await ana.page.getByRole("tab", { name: /People/ }).click();
  const soup = ana.page.locator("section", { hasText: "The host added these for" }).getByRole("listitem").filter({ hasText: "Soup" });
  await soup.getByRole("button", { name: "That’s mine" }).click();
  await page.getByRole("tab", { name: /People/ }).click();
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
  await sheet.getByLabel("Service charge from receipt (₱)").fill("0");
  await sheet.getByRole("region", { name: "Service charge" }).getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByText("No service charge on this receipt.")).toBeVisible(T);

  // Flagged: the line stays with the tag, nothing counts as paid, Left is the whole ₱300.
  await sheet.locator("details").filter({ hasText: "Ana" }).first().evaluate((d: HTMLDetailsElement) => (d.open = true));
  await expect(sheet.getByText("Needs review")).toBeVisible(T);
  await expect(sheet.getByRole("region", { name: "Payments" })).toContainText("₱0.00", T);
  await expect(sheet.getByText("₱300.00").first()).toBeVisible(T);

  await sheet.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("button", { name: /^Updates/ }).click();
  await expect(page.getByRole("dialog", { name: "Updates" })).toContainText("Ana’s claim left a ₱100.00 payment paid to themself", T);
  await page.keyboard.press("Escape");
  await openKkb(page);
  await sheet.locator("details").filter({ hasText: "Ana" }).first().evaluate((d: HTMLDetailsElement) => (d.open = true));

  // Ana's phone shows the same, then the fix lands live.
  await ana.page.getByRole("tab", { name: /People/ }).click();
  await ana.page.getByRole("button", { name: "Who ordered what" }).click();
  const anaSheet = ana.page.getByRole("dialog", { name: "Who ordered what" });
  await anaSheet.getByRole("tab", { name: "KKB" }).click();
  await expect(anaSheet.getByText("Needs review")).toBeVisible(T);
  await expect(anaSheet.getByRole("button", { name: /^Fix/ })).toHaveCount(0);

  await sheet.getByRole("button", { name: /^Fix ₱100.00 payment/ }).click();
  const drawer = page.getByRole("dialog", { name: "Fix payment" });
  await expect(drawer.getByRole("button", { name: "Save" })).toBeDisabled();
  await drawer.getByText("Restaurant", { exact: true }).click();
  await Promise.all([page.waitForResponse((r) => r.url().includes("/payments/") && r.request().method() === "PATCH", T), drawer.getByRole("button", { name: "Save" }).click()]);
  await expect(drawer).toBeHidden(T);
  await expect(sheet.getByText("Needs review")).toHaveCount(0, T);
  await expect(anaSheet.getByText("Needs review")).toHaveCount(0, T);
  await expect(anaSheet.getByText("Partly paid")).toBeVisible(T);
  await ana.context.close();
});
