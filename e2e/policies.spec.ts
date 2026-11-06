import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("privacy and cookie policies are reachable, readable and accessible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Policies" }).getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy policy", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "salo@projects.thekovie.com" }).first()).toHaveAttribute("href", "mailto:salo@projects.thekovie.com");
  await expect(page.getByText(/Replays hide everything you type/)).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

  await page.getByRole("navigation", { name: "Policies" }).first().getByRole("link", { name: "Cookies" }).click();
  await expect(page.getByRole("heading", { name: "Cookie policy", level: 1 })).toBeVisible();
  await expect(page.getByRole("cell", { name: "salo_s_<order>" })).toBeVisible();
  // Analytics isn't configured in tests, so the switch says there's nothing to turn off.
  await expect(page.getByText(/Analytics isn’t running in this browser/)).toBeVisible({ timeout: 6000 });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/privacy");
  expect(sitemap).toContain("/cookies");
});
