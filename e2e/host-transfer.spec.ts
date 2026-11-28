import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { inviteCode, joinAsGuest, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };

test("hand over host: the new host gets host controls and an update, the old host becomes a guest without a tour", async ({ page, browser }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const jun = await joinAsGuest(browser, await inviteCode(page), "Jun");
  await expect(jun.page.getByRole("button", { name: "Order options" })).toHaveCount(0);

  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: /Hand over host/ }).click();
  await page.getByRole("radio", { name: /Jun/ }).check();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox").fill("Kovie");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
  const put = page.waitForResponse((r) => r.url().endsWith("/host") && r.request().method() === "PUT" && r.ok(), T);
  await Promise.all([put, page.getByRole("button", { name: "Make Jun the host" }).click()]);

  await expect(page.getByRole("button", { name: "Order options" })).toHaveCount(0, T);
  await expect(page.getByRole("dialog")).toHaveCount(0, T);
  await expect(jun.page.getByRole("button", { name: "Order options" })).toBeVisible(T);
  await expect(jun.page.getByRole("button", { name: /^Updates/ })).toBeVisible(T);
  await jun.page.getByRole("button", { name: /^Updates/ }).click();
  await expect(jun.page.getByText("Kovie made you the host.")).toBeVisible(T);
  await jun.context.close();
});
