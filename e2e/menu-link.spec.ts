import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addDish, confirmRound1, endOrder, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };
const axe = async (page: Page) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
};

async function openMenuStep(page: Page) {
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: /Menu link/ }).click();
  await expect(page.getByLabel("Link", { exact: true })).toBeFocused(T);
}

test("host adds, edits and removes the menu link; guests see it live; ended orders hide it", async ({ page, browser }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const jun = await joinAsGuest(browser, await inviteCode(page), "Jun");
  await expect(jun.page.getByRole("link", { name: /opens in a new tab/ })).toHaveCount(0);

  // Invalid input: reason under the field, Save disabled.
  await openMenuStep(page);
  await page.getByLabel("Link", { exact: true }).fill("http://example.com");
  await expect(page.getByText("Use the https:// address of the menu.")).toBeVisible(T);
  await expect(page.getByRole("button", { name: "Save link" })).toBeDisabled();
  await page.getByLabel("Link", { exact: true }).fill("ramennagi.com.ph/menu");
  await expect(page.getByText("Opens ramennagi.com.ph")).toBeVisible(T);
  await axe(page);

  const save = page.waitForResponse((r) => r.url().endsWith("/menu") && r.request().method() === "PUT" && r.ok(), T);
  await Promise.all([save, page.getByRole("button", { name: "Save link" }).click()]);
  await expect(page.getByRole("button", { name: /Menu link/ })).toBeFocused(T);
  await expect(page.getByRole("button", { name: /Menu link/ })).toContainText("ramennagi.com.ph");
  await page.keyboard.press("Escape");

  // Host row, no report link; guest row live, with the safety attributes and the report link.
  await expect(page.getByRole("link", { name: "View menu, ramennagi.com.ph, opens in a new tab" })).toBeVisible(T);
  await expect(page.getByRole("link", { name: /Report/ })).toHaveCount(0);
  const row = jun.page.getByRole("link", { name: "View menu, ramennagi.com.ph, opens in a new tab" });
  await expect(row).toBeVisible(T);
  await expect(row).toHaveAttribute("href", "https://ramennagi.com.ph/menu");
  await expect(row).toHaveAttribute("target", "_blank");
  expect(await row.getAttribute("rel")).toContain("noopener");
  expect(await row.getAttribute("rel")).toContain("noreferrer");
  const href = (await jun.page.getByRole("link", { name: /Report/ }).getAttribute("href")) ?? "";
  expect(href).toMatch(/^mailto:salo@projects\.thekovie\.com\?subject=Suspicious%20menu%20link&body=/);
  expect(decodeURIComponent(href)).toContain("https://ramennagi.com.ph/menu");
  await axe(jun.page);

  // Edit the label.
  await openMenuStep(page);
  await page.getByLabel("Label (optional)").fill("Drinks menu");
  const edit = page.waitForResponse((r) => r.url().endsWith("/menu") && r.request().method() === "PUT" && r.ok(), T);
  await Promise.all([edit, page.getByRole("button", { name: "Save link" }).click()]);
  await page.keyboard.press("Escape");
  await expect(jun.page.getByRole("link", { name: "Drinks menu, ramennagi.com.ph, opens in a new tab" })).toBeVisible(T);

  // Remove: the guest row goes away.
  await openMenuStep(page);
  const remove = page.waitForResponse((r) => r.url().endsWith("/menu") && r.request().method() === "PUT" && r.ok(), T);
  await Promise.all([remove, page.getByRole("button", { name: "Remove link" }).click()]);
  await expect(page.getByRole("button", { name: /Menu link/ })).toContainText("Add a link", T);
  await page.keyboard.press("Escape");
  await expect(jun.page.getByRole("link", { name: /opens in a new tab/ })).toHaveCount(0, T);

  // Set again, then End: the row is hidden for the guest.
  await openMenuStep(page);
  await page.getByLabel("Link", { exact: true }).fill("https://ramennagi.com.ph/menu");
  const again = page.waitForResponse((r) => r.url().endsWith("/menu") && r.request().method() === "PUT" && r.ok(), T);
  await Promise.all([again, page.getByRole("button", { name: "Save link" }).click()]);
  await page.keyboard.press("Escape");
  await expect(jun.page.getByRole("link", { name: /opens in a new tab/ })).toBeVisible(T);
  await jun.page.getByRole("link", { name: /opens in a new tab/ }).focus();
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: /Menu link/ }).click();
  const gone = page.waitForResponse((r) => r.url().endsWith("/menu") && r.request().method() === "PUT" && r.ok(), T);
  await Promise.all([gone, page.getByRole("button", { name: "Remove link" }).click()]);
  await page.keyboard.press("Escape");
  // Focus was on the removed link: it moves to the tab panel, not to <body>.
  await expect(jun.page.locator("#panel-order")).toBeFocused(T);

  await openMenuStep(page);
  await page.getByLabel("Link", { exact: true }).fill("https://ramennagi.com.ph/menu");
  const third = page.waitForResponse((r) => r.url().endsWith("/menu") && r.request().method() === "PUT" && r.ok(), T);
  await Promise.all([third, page.getByRole("button", { name: "Save link" }).click()]);
  await page.keyboard.press("Escape");
  await addDish(page, "Gyoza");
  await confirmRound1(page);
  await endOrder(page);
  await jun.page.getByRole("tab", { name: /Order/ }).click();
  await expect(jun.page.getByRole("link", { name: /opens in a new tab/ })).toHaveCount(0, T);
  await expect(page.getByRole("link", { name: /opens in a new tab/ })).toHaveCount(0);
  await jun.context.close();
});
