import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addDish, confirmRound1, inviteCode, joinAsGuest, openKkb, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };

async function price(sheet: ReturnType<Page["getByRole"]>, dish: string, amount: string) {
  await sheet.getByRole("button", { name: `Add price, ${dish}` }).click();
  const form = sheet.getByRole("form", { name: `Price for ${dish}` });
  await form.getByLabel("Price each (₱)").fill(amount);
  await Promise.all([form.getByRole("button", { name: "Save" }).click(), expect(form).toBeHidden(T)]);
}

/** Host Chicken Katsu (₱120) and JD Iced Tea (₱60), confirmed, priced, KKB sheet open on the host's phone. */
async function pricedOrder(page: Page, browser: Parameters<typeof joinAsGuest>[0]) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Chicken Katsu");
  await addDish(guest.page, "Iced Tea");
  await expect(page.getByTestId("dish-row").filter({ hasText: "Iced Tea" })).toBeVisible(T);
  await confirmRound1(page);
  await openKkb(page);
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  await price(sheet, "Chicken Katsu", "120");
  await price(sheet, "Iced Tea", "60");
  return { guest, sheet };
}

async function addDiscount(page: Page, who: string | null, amount: string) {
  await page.getByRole("button", { name: "Add discount or charge" }).click();
  const form = page.getByRole("dialog", { name: "Add discount or charge" });
  if (who) await form.getByLabel("Who").selectOption({ label: who });
  else await form.getByRole("radio", { name: "Decide later" }).check();
  await form.getByLabel("Amount in pesos").fill(amount);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/adjustments/") && r.request().method() === "PUT", T), form.getByRole("button", { name: "Save" }).click()]);
  await expect(form).toBeHidden(T);
}

test("adjustments: a senior discount for one guest updates their card, the dock and the receipt check live", async ({ page, browser }) => {
  test.slow();
  const { guest, sheet } = await pricedOrder(page, browser);
  await addDiscount(page, "JD", "10");

  const block = sheet.getByRole("region", { name: "Discounts and extras" });
  await expect(block.getByText("Senior citizen discount for JD")).toBeVisible(T);
  await expect(block.getByText("−₱10.00")).toBeVisible();

  const dock = guest.page.getByRole("button", { name: /^(My share|Share) · ₱50$|^Share ₱50$/ });
  await expect(dock).toBeVisible(T);
  await dock.click();
  await expect(guest.page.getByRole("region", { name: /JD, your share/ })).toContainText("₱50.00", T);

  const receipt = sheet.getByRole("region", { name: "Check against the receipt" });
  await receipt.getByLabel("Receipt total (₱)").fill("170");
  await receipt.getByRole("button", { name: "Save" }).click();
  await expect(receipt.getByText("Adjusted total")).toBeVisible(T);
  await expect(receipt.getByText("Matches the receipt.")).toBeVisible(T);
  await guest.context.close();
});

test("adjustments: Decide later leaves cards alone and reads so far", async ({ page, browser }) => {
  test.slow();
  const { guest, sheet } = await pricedOrder(page, browser);
  await addDiscount(page, null, "10");
  await expect(sheet.getByRole("region", { name: "Discounts and extras" }).getByText("Not assigned yet")).toBeVisible(T);
  await expect(guest.page.getByRole("button", { name: /(My share|Share) so far[ ·]+₱60/ })).toBeVisible(T);
  await guest.context.close();
});

test("adjustments: the host can still add one after the order ends", async ({ page, browser }) => {
  test.slow();
  const { guest } = await pricedOrder(page, browser);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: "End order" }).click();
  await page.getByRole("dialog", { name: "End this order?" }).getByRole("button", { name: "Yes, end the order" }).click();
  await expect(page.getByText(/The host can still fix prices and the bill/)).toBeVisible(T);
  await expect(page.getByRole("dialog", { name: "Who ordered what" })).toBeVisible(T);
  await addDiscount(page, "JD", "10");
  await expect(page.getByRole("dialog", { name: "Who ordered what" }).getByText("Senior citizen discount for JD")).toBeVisible(T);
  await guest.context.close();
});

test("adjustments: the sheet passes axe in light and dark", async ({ page, browser }) => {
  test.slow();
  const { guest } = await pricedOrder(page, browser);
  await page.getByRole("button", { name: "Add discount or charge" }).click();
  await expect(page.getByRole("dialog", { name: "Add discount or charge" })).toBeVisible(T);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
  await guest.context.close();
});

test("adjustments: Keep mine after a change from another phone saves at once", async ({ page, browser }) => {
  test.slow();
  const { guest, sheet } = await pricedOrder(page, browser);
  await addDiscount(page, "JD", "10");
  const block = sheet.getByRole("region", { name: "Discounts and extras" });
  await block.getByRole("button", { name: "Edit Senior citizen discount for JD" }).click();
  const form = page.getByRole("dialog", { name: "Edit discount" });
  await form.getByLabel("Amount in pesos").fill("15");

  // Another phone (same host) changes it to ₱20 first.
  await page.evaluate(async () => {
    const id = location.pathname.split("/s/")[1];
    const snap = (await (await fetch(`/api/sessions/${id}/sync`)).json()).data;
    const a = snap.settlement.adjustments[0];
    await fetch(`/api/sessions/${id}/adjustments/${a.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ expectedRevision: a.revision, direction: "discount", category: "senior", note: null, amountCentavos: 2000, method: "individual", shares: [{ participantId: a.shares[0].participantId }] }),
    });
  });
  await expect(form.getByRole("alert")).toContainText("Changed just now", T);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/adjustments/") && r.request().method() === "PUT" && r.ok(), T), form.getByRole("button", { name: "Keep mine" }).click()]);
  await expect(form).toBeHidden(T);
  await expect(block.getByText("−₱15.00")).toBeVisible(T);
  await guest.context.close();
});
