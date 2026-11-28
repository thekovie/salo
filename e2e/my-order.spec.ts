import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, orderFor, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };

test("My order: a guest sees what is theirs, what the host added, fixes it and says ready; the host sees the count and 'No order yet'", async ({ page, browser }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const code = await inviteCode(page);
  const rafa = await joinAsGuest(browser, code, "Rafa");
  const jun = await joinAsGuest(browser, code, "Jun");
  await rafa.page.emulateMedia({ reducedMotion: "reduce" });

  await addDish(rafa.page, "Chicken Katsu");
  await orderFor(page, "A person", "Rafa");
  await addDish(page, "Halo-halo");
  await orderFor(page, "Whole table");
  await addDish(page, "Rice");

  await rafa.page.getByRole("button", { name: "My order", exact: true }).click();
  const sheet = rafa.page.getByRole("dialog", { name: "My order" });
  await expect(sheet.getByText("Chicken Katsu")).toBeVisible(T);
  await expect(sheet.getByText("Halo-halo")).toBeVisible(T);
  await expect(sheet.getByText("Rice")).toBeVisible(T);
  // Arrival tags fade for ARRIVAL_MS, then unmount; axe mid-fade reads the blended colour as low contrast.
  await expect(rafa.page.locator(".arrival-tag, .arrival-pill")).toHaveCount(0, T);
  for (const scheme of ["light", "dark"] as const) {
    await rafa.page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page: rafa.page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }

  // Host-added dishes for Rafa can be claimed; the whole-table dish cannot.
  const claim = sheet.getByRole("button", { name: /That.s mine/ });
  await expect(claim).toHaveCount(1, T);
  await expect(sheet.getByRole("region", { name: "Shared" }).getByRole("button", { name: /That.s mine/ })).toHaveCount(0);
  await claim.click();
  await expect(sheet.getByText("Asked the host")).toBeVisible(T);

  await sheet.getByRole("button", { name: "One more Chicken Katsu" }).click();
  await expect(sheet.getByRole("group", { name: "Quantity of Chicken Katsu" })).toContainText("2", T);

  const ready = rafa.page.waitForResponse((r) => r.url().includes("/readiness") && r.request().method() === "PUT" && r.ok(), T);
  await Promise.all([ready, sheet.getByRole("button", { name: "I’m ready" }).click()]);
  await expect(sheet.getByRole("button", { name: /Ready · tap to undo/ })).toBeVisible(T);
  await expect(page.getByText("1/1 guest ready")).toBeVisible(T);

  await page.getByRole("tab", { name: /People/ }).click();
  await expect(page.getByText("No order yet")).toBeVisible(T);
  await expect(page.locator("section.ticket", { hasText: "Chicken Katsu" }).first()).toContainText("×2", T);
  await rafa.context.close();
  await jun.context.close();
});
