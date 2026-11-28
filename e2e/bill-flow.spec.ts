import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDish, confirmRound1, endOrder, inviteCode, joinAsGuest, openKkb, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };
const AXE = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** Jun's Rice and Liza's Katsu, confirmed, nothing priced: the host's KKB is open. */
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
  return { jun, liza };
}

async function price(sheet: Locator, dish: string, amount: string) {
  await sheet.getByRole("button", { name: `Add price, ${dish}` }).click();
  const form = sheet.getByRole("form", { name: `Price for ${dish}` });
  await form.getByLabel("Price each (₱)").fill(amount);
  await Promise.all([form.getByRole("button", { name: "Save" }).click(), expect(form).toBeHidden(T)]);
}

async function guestKkb(page: Page) {
  await page.getByRole("tab", { name: /People/ }).click();
  await page.getByRole("button", { name: "Who ordered what" }).click();
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await sheet.getByRole("tab", { name: "KKB" }).click();
  return sheet;
}

test("the host walks the bill with the next-step button; a guest sees so far, then final; the full record copies", async ({ page, browser, context }) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {}); // webkit has no clipboard permission
  const { jun, liza } = await scene(page, browser);
  await openKkb(page);
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  const row = (text: string | RegExp) => sheet.getByText(text);

  // Prices left: the host has the Enter prices link below, no row; a guest sees what everyone waits on.
  await expect(sheet.getByRole("button", { name: /^Go:/ })).toHaveCount(0);
  const junSheet = await guestKkb(jun.page);
  await expect(junSheet.getByText("Shares so far · waiting on 2 dishes without a price")).toBeVisible(T);
  await expect(junSheet.getByRole("button", { name: /^Go:/ })).toHaveCount(0);

  await price(sheet, "Rice", "100");
  await price(sheet, "Katsu", "200");
  await expect(row("Next: add the service charge from the receipt")).toBeVisible(T);
  await expect(sheet.getByText("so far", { exact: true }).first()).toBeVisible();
  await expect(junSheet.getByText("Shares so far · waiting on the host to add the service charge")).toBeVisible(T);

  // Go lands on the service charge block.
  await sheet.getByRole("button", { name: "Go: Add the service charge from the receipt" }).click();
  await expect(sheet.locator("#kkb-service")).toBeFocused();
  await sheet.getByLabel("Service charge from receipt (₱)").fill("0");
  await sheet.getByRole("region", { name: "Service charge" }).getByRole("button", { name: "Save" }).click();
  await expect(row("Shares are final · Check the total against the receipt")).toBeVisible(T);
  await expect(junSheet.getByText("Shares are final", { exact: true })).toBeVisible(T);
  await expect(sheet.getByText("so far", { exact: true })).toHaveCount(0);

  await sheet.getByRole("button", { name: "Go: Check the total against the receipt" }).click();
  await expect(sheet.locator("#kkb-receipt")).toBeFocused();
  const receipt = sheet.getByRole("region", { name: "Check against the receipt" });
  await receipt.getByLabel("Receipt total (₱)").fill("300");
  await receipt.getByRole("button", { name: "Save" }).click();
  await expect(row("Shares are final · Record payments · 0 of 2 paid")).toBeVisible(T);

  await sheet.getByRole("button", { name: "Go: Record payments · 0 of 2 paid" }).click();
  for (const [i, who] of ["Jun", "Liza"].entries()) {
    if (i) await sheet.getByRole("button", { name: `Go: Record payments · ${i} of 2 paid` }).click(); // lands on the next card still owing
    await expect(sheet.getByRole("button", { name: "Record payment", exact: true }).nth(i)).toBeFocused();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: `Record payment from ${who}` });
    await drawer.getByLabel(/^Amount/).fill(who === "Jun" ? "100" : "200");
    await Promise.all([page.waitForResponse((r) => r.url().includes("/payments/") && r.request().method() === "PUT", T), drawer.getByRole("button", { name: /^Record/ }).click()]);
    await expect(drawer).toBeHidden(T);
  }
  await expect(sheet.getByText("Shares are final", { exact: true })).toBeVisible(T);
  await expect(sheet.getByRole("button", { name: /^Go:/ })).toHaveCount(0);

  // The full record: off by default, on adds every section.
  const copy = async () => {
    await sheet.getByRole("button", { name: "Copy summary" }).click();
    await expect(sheet.getByText("Summary copied")).toBeVisible(T);
    return page.evaluate(() => navigator.clipboard.readText());
  };
  if (test.info().project.name !== "webkit") {
    expect(await copy()).not.toContain("Orders");
    await sheet.getByLabel("Include the full record").check();
    const text = await copy();
    for (const heading of ["Orders", "Served", "Receipt", "Payments"]) expect(text).toContain(`\n${heading}\n`);
    expect(text).toContain("Jun: Rice ×1");
    expect(text).toContain("Receipt total ₱300.00 · matches");
    expect(text).toContain("Jun paid ₱100.00 · paid");
  }

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(AXE).analyze()).violations).toEqual([]);
  }
  await jun.context.close();
  await liza.context.close();
});

test("the ended block names the next step and opens the bill at it", async ({ page, browser }) => {
  test.slow();
  const { jun, liza } = await scene(page, browser);
  await openKkb(page);
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await price(sheet, "Rice", "100");
  await price(sheet, "Katsu", "200");
  await page.keyboard.press("Escape");
  await endOrder(page);
  await expect(page.getByRole("main").getByText("Next: add the service charge from the receipt")).toBeVisible(T);
  await page.getByRole("button", { name: "Open bill: Add the service charge from the receipt" }).click();
  await expect(page.getByRole("dialog", { name: "Who ordered what" }).locator("#kkb-service")).toBeFocused(T);
  await jun.context.close();
  await liza.context.close();
});
