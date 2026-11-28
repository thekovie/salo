import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addDish, confirmRound1, inviteCode, joinAsGuest, openKkb, orderFor, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };
const AXE = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** Host's shared Crispy Pata, Jun's Rice (₱100) and Liza's Katsu (₱200), confirmed, KKB open on the host's phone. */
async function scene(page: Page, browser: Parameters<typeof joinAsGuest>[0]) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const code = await inviteCode(page);
  const jun = await joinAsGuest(browser, code, "Jun");
  const liza = await joinAsGuest(browser, code, "Liza");
  await addDish(jun.page, "Rice");
  await addDish(liza.page, "Katsu");
  await orderFor(page, "Whole table");
  await addDish(page, "Crispy Pata");
  await expect(page.getByTestId("dish-row").filter({ hasText: "Katsu" })).toBeVisible(T);
  await confirmRound1(page);
  await openKkb(page);
  const sheet = page.getByRole("dialog", { name: "Who ordered what" });
  for (const [dish, amount] of [["Crispy Pata", "780"], ["Rice", "100"], ["Katsu", "200"]]) {
    await sheet.getByRole("button", { name: `Add price, ${dish}` }).click();
    const form = sheet.getByRole("form", { name: `Price for ${dish}` });
    await form.getByLabel("Price each (₱)").fill(amount);
    if (dish === "Crispy Pata") {
      await form.getByText("Split equally…", { exact: true }).click();
      const picker = form.getByRole("group", { name: "Who shares this dish" });
      await picker.getByRole("checkbox", { name: "Jun" }).check();
      await picker.getByRole("checkbox", { name: "Liza" }).check();
      await expect(form.getByText("₱390.00 each")).toBeVisible(T);
    }
    await Promise.all([form.getByRole("button", { name: "Save" }).click(), expect(form).toBeHidden(T)]);
  }
  return { sheet, jun, liza };
}

test("a host splits Crispy Pata, adds a senior receipt for Liza; the guest reads it read-only", async ({ page, browser }) => {
  test.slow();
  const { sheet, jun, liza } = await scene(page, browser);
  await expect(sheet.getByRole("group").filter({ hasText: "Jun" }).first()).toContainText("₱490.00");
  await expect(sheet.getByRole("group").filter({ hasText: "Liza" }).first()).toContainText("₱590.00");

  const check = sheet.getByRole("region", { name: "Check against the receipt" });
  await check.getByRole("button", { name: "Add another receipt" }).click();
  const drawer = page.getByRole("dialog", { name: "Add a receipt" });
  await drawer.getByLabel("Label").fill("Senior citizen receipt");
  await drawer.getByRole("checkbox", { name: /Liza/ }).check();
  await drawer.getByLabel("Receipt total (₱)").fill("590");
  await expect(drawer.getByText(/Salo has ₱590.00 for Liza/)).toBeVisible(T);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/receipts/") && r.request().method() === "PUT", T), drawer.getByRole("button", { name: "Save" }).click()]);
  await expect(drawer).toBeHidden(T);
  await expect(check.getByRole("region", { name: "Senior citizen receipt" })).toBeVisible(T);
  await expect(check.getByRole("region", { name: "Main receipt" })).toContainText("Salo ₱490.00");

  await liza.page.getByRole("tab", { name: /People/ }).click();
  await liza.page.getByRole("button", { name: "Who ordered what" }).click();
  const guestSheet = liza.page.getByRole("dialog", { name: "Who ordered what" });
  await guestSheet.getByRole("tab", { name: "KKB" }).click();
  const guestCheck = guestSheet.getByRole("region", { name: "Check against the receipt" });
  await expect(guestCheck.getByRole("region", { name: "Senior citizen receipt" })).toBeVisible(T);
  await expect(guestCheck.getByRole("button", { name: /Add another receipt|Edit/ })).toHaveCount(0);
  await expect(guestCheck.getByLabel("Receipt total (₱)")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await jun.context.close();
  await liza.context.close();
});

test("the split and receipt sheets pass axe in light and dark", async ({ page, browser }) => {
  test.slow();
  const { sheet, jun, liza } = await scene(page, browser);
  await sheet.getByRole("region", { name: "Check against the receipt" }).getByRole("button", { name: "Add another receipt" }).click();
  await expect(page.getByRole("dialog", { name: "Add a receipt" })).toBeVisible(T);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(AXE).analyze()).violations).toEqual([]);
  }
  await jun.context.close();
  await liza.context.close();
});
