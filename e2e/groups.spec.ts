import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { addDish, inviteCode, joinAsGuest, orderFor, startOrder } from "./support/helpers";

test("collective group ordering with optional members (scenario 3)", async ({ page, browser }) => {
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "Rafa");

  await orderFor(page, "A group", "Miguel's group");
  await addDish(page, "Chicken Katsu", 2);
  await addDish(page, "Gyoza");
  await addDish(page, "Iced Tea", 3);

  await page.getByRole("tab", { name: /Groups/ }).click();
  const group = page.getByRole("tabpanel").locator("section", { hasText: "Miguel's group" });
  await expect(group).toContainText("6 items");
  await group.getByRole("button", { name: "Add members" }).click();
  const dialog = page.getByRole("dialog", { name: /Who’s in Miguel's group/ });
  await dialog.getByRole("checkbox", { name: "Rafa" }).check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(group.getByRole("list", { name: /Members of/ })).toHaveText("Rafa");

  // Everyone sees the same group, live; the consolidated order is unchanged by grouping.
  await guest.page.getByRole("tab", { name: /Groups/ }).click();
  await expect(guest.page.getByRole("tabpanel")).toContainText("Miguel's group");
  await expect(guest.page.getByRole("list", { name: /Members of/ })).toHaveText("Rafa");
  await page.getByRole("tab", { name: /Order/ }).click();
  await expect(page.getByTestId("round-total")).toContainText("6");
  await guest.context.close();
});

test("hybrid: a guest claims a dish the host recorded for them; duplicate hint; readiness (scenario 4)", async ({ page, browser }) => {
  // The accessibility scans below measure settled colours, never a toast or highlight mid-animation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "Rafa");
  await guest.page.emulateMedia({ reducedMotion: "reduce" });

  await orderFor(page, "A person", "Rafa");
  await addDish(page, "Chicken Katsu");
  await addDish(page, "Halo-halo");
  await guest.page.getByRole("button", { name: "I’m ready" }).click();
  await expect(page.getByText("1 of 1 guest ready")).toBeVisible();

  // The guest also adds Chicken Katsu: the host sees a possible double order and their readiness resets.
  await addDish(guest.page, "Chicken Katsu");
  await expect(page.getByText("0 of 1 guest ready")).toBeVisible();
  await page.getByRole("tab", { name: /People/ }).click();
  await expect(page.getByText(/Rafa added Chicken Katsu ×1, and you also added it for them/)).toBeVisible();
  await page.getByRole("button", { name: "Remove your copy" }).click();
  await expect(page.getByText("Possibly ordered twice")).toHaveCount(0);

  // The guest claims the Halo-halo the host recorded under their name; the host approves.
  await guest.page.getByRole("tab", { name: /People/ }).click();
  // Dishes the host typed under the guest's name sit inside the guest's own card.
  const named = guest.page.locator("section", { hasText: "The host added these for" });
  await expect(guest.page.getByText("added by the host")).toHaveCount(0);
  const halo = named.getByRole("listitem").filter({ hasText: "Halo-halo" });
  await halo.getByRole("button", { name: "That’s mine" }).click();
  await expect(halo.getByText("Asked the host")).toBeVisible();
  await expect(page.getByText(/Rafa says Halo-halo ×1 is theirs/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/says Halo-halo/)).toHaveCount(0);

  // People and Groups views pass the automated accessibility scan, for host and guest.
  for (const target of [page, guest.page]) {
    const results = await new AxeBuilder({ page: target }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations).toEqual([]);
  }
  await page.getByRole("tab", { name: /Groups/ }).click();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

  // It is now the guest's own dish: they can change it.
  await guest.page.getByRole("tab", { name: /Order/ }).click();
  await expect(guest.page.getByRole("button", { name: "One more Halo-halo" })).toBeVisible();
  await guest.context.close();
});
