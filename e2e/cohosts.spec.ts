import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addDish, confirmRound1, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };
const served = (page: Page) => page.getByTestId("served-section");
const summary = (page: Page) => page.getByTestId("served-summary");
const putCohost = (page: Page) => page.waitForResponse((r) => r.url().includes("/cohost") && r.request().method() === "PUT" && r.ok(), T);

/** Host, three guests, 3 Katsu on one confirmed round. */
async function table(page: Page, browser: Parameters<typeof joinAsGuest>[0], names: string[]) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const code = await inviteCode(page);
  const guests: Record<string, Awaited<ReturnType<typeof joinAsGuest>>> = {};
  for (const name of names) guests[name] = await joinAsGuest(browser, code, name);
  await addDish(page, "Chicken Katsu", 3);
  await confirmRound1(page);
  await expect(served(page)).toBeVisible(T);
  return guests;
}

async function makeCohost(page: Page, name: string) {
  await page.getByRole("tab", { name: /People/ }).click();
  await Promise.all([putCohost(page), page.getByRole("button", { name: `Make co-host for ${name}` }).click()]);
  await expect(page.getByRole("button", { name: `Stop co-host for ${name}` })).toBeVisible(T);
  await page.getByRole("tab", { name: "Order" }).click();
}

test("a co-host marks food served live; a plain guest stays read-only; revoking removes the controls", async ({ page, browser }) => {
  test.slow();
  const { Jun, Liza } = await table(page, browser, ["Jun", "Liza"]);
  const junServed = served(Jun.page);
  await expect(junServed).toBeVisible(T);
  await expect(junServed.getByRole("button", { name: /One more/ })).toHaveCount(0);

  await page.getByRole("tab", { name: /People/ }).click();
  await expect(page.getByText("· co-host")).toHaveCount(0);
  await makeCohost(page, "Jun");

  await expect(Jun.page.getByText("You’re a co-host: you can mark food as served.")).toBeVisible(T);
  const katsu = junServed.getByRole("listitem").filter({ hasText: "Chicken Katsu" });
  const tap = Jun.page.waitForResponse((r) => r.url().includes("/serving") && r.request().method() === "POST" && r.ok(), T);
  await Promise.all([tap, katsu.getByRole("button", { name: "One more Chicken Katsu served" }).click()]);
  await expect(summary(Jun.page)).toHaveText("1 of 3 served · 2 waiting", T);
  await expect(summary(page)).toHaveText("1 of 3 served · 2 waiting", T);
  await expect(Liza.page.getByTestId("served-summary")).toHaveText("1 of 3 served · 2 waiting", T);
  await expect(served(Liza.page).getByRole("button", { name: /One more/ })).toHaveCount(0);
  await expect(Liza.page.getByText("You’re a co-host")).toHaveCount(0);

  await page.getByRole("tab", { name: /People/ }).click();
  await Promise.all([putCohost(page), page.getByRole("button", { name: "Stop co-host for Jun" }).click()]);
  await expect(junServed.getByRole("button", { name: /One more/ })).toHaveCount(0, T);
  await expect(Jun.page.getByText("You’re a co-host")).toHaveCount(0);
  await expect(summary(Jun.page)).toHaveText("1 of 3 served · 2 waiting");
  await Jun.context.close();
  await Liza.context.close();
});

test("two co-hosts tapping the same plate at once count it once", async ({ page, browser }) => {
  test.slow();
  const { Jun, Ben } = await table(page, browser, ["Jun", "Ben"]);
  await makeCohost(page, "Jun");
  await makeCohost(page, "Ben");
  const more = (p: Page) => served(p).getByRole("button", { name: "One more Chicken Katsu served" });
  await expect(more(Jun.page)).toBeVisible(T);
  await expect(more(Ben.page)).toBeVisible(T);
  const posted = (p: Page) => p.waitForResponse((r) => r.url().includes("/serving") && r.request().method() === "POST" && r.ok(), T);
  await Promise.all([posted(Jun.page), posted(Ben.page), more(Jun.page).click(), more(Ben.page).click()]);
  for (const p of [page, Jun.page, Ben.page]) await expect(summary(p)).toHaveText("1 of 3 served · 2 waiting", T);
  await Jun.context.close();
  await Ben.context.close();
});

test("People and Served pass axe in light and dark with a co-host", async ({ page, browser }) => {
  test.slow();
  const { Jun } = await table(page, browser, ["Jun"]);
  await makeCohost(page, "Jun");
  const scan = async () => expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await scan();
    await page.getByRole("tab", { name: /People/ }).click();
    await expect(page.getByRole("button", { name: "Stop co-host for Jun" })).toBeVisible();
    await scan();
    await page.getByRole("tab", { name: "Order" }).click();
  }
  await Jun.context.close();
});

test("a co-host revoked and re-granted with an unsaved tap sees the real count, not the dropped tap", async ({ page, browser }) => {
  test.slow();
  const { Jun } = await table(page, browser, ["Jun"]);
  await makeCohost(page, "Jun");
  const more = served(Jun.page).getByRole("button", { name: "One more Chicken Katsu served" });
  await expect(more).toBeVisible(T);
  await Jun.page.route("**/serving", (route) => route.abort());
  const tried = Jun.page.waitForRequest((r) => r.url().includes("/serving") && r.method() === "POST", T);
  await Promise.all([tried, more.click()]);
  await expect(served(Jun.page).getByRole("button", { name: /Try again/ })).toBeVisible(T);

  await page.getByRole("tab", { name: /People/ }).click();
  await Promise.all([putCohost(page), page.getByRole("button", { name: "Stop co-host for Jun" }).click()]);
  await expect(more).toHaveCount(0, T);
  await Promise.all([putCohost(page), page.getByRole("button", { name: "Make co-host for Jun" }).click()]);
  await expect(more).toBeVisible(T);
  await expect(summary(Jun.page)).toHaveText("0 of 3 served · 3 waiting", T);
  await expect(served(Jun.page).getByRole("button", { name: /Try again/ })).toHaveCount(0);
  await Jun.context.close();
});
