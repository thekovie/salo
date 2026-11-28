import { expect, test, type Page } from "@playwright/test";
import { addDish, confirmRound1, endOrder, inviteCode, joinAsGuest, openKkb, startOrder } from "./support/helpers";

const T = { timeout: 15_000 };

async function api(page: Page, path: string) {
  return page.evaluate(async (p) => (await fetch(p)).json(), path);
}

/** Answers the first matching PUT/POST for real, then drops the response so the page sees a network failure. */
async function loseFirstResponse(page: Page, url: RegExp, methods = ["PUT"]) {
  let seen = 0;
  await page.route(url, async (route) => {
    if (!methods.includes(route.request().method()) || seen++ > 0) return route.continue();
    await route.fetch();
    await route.abort("failed");
  });
}

/** Host's Katsu (₱120) and JD's Iced Tea (₱60), confirmed and priced, KKB sheet open on the host's phone. */
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
  for (const [dish, amount] of [["Chicken Katsu", "120"], ["Iced Tea", "60"]]) {
    await sheet.getByRole("button", { name: `Add price, ${dish}` }).click();
    const form = sheet.getByRole("form", { name: `Price for ${dish}` });
    await form.getByLabel("Price each (₱)").fill(amount);
    await Promise.all([form.getByRole("button", { name: "Save" }).click(), expect(form).toBeHidden(T)]);
  }
  return { guest, sheet };
}

test("a discount whose response was lost is saved once when the host taps Try again", async ({ page, browser }) => {
  test.slow();
  const { guest, sheet } = await pricedOrder(page, browser);
  await loseFirstResponse(page, /\/adjustments\//);
  await page.getByRole("button", { name: "Add discount or charge" }).click();
  const form = page.getByRole("dialog", { name: "Add discount or charge" });
  await form.getByLabel("Who").selectOption({ label: "JD" });
  await form.getByLabel("Amount in pesos").fill("10");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toContainText("Not saved.", T);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/adjustments/") && r.request().method() === "PUT", T), form.getByRole("button", { name: "Try again" }).click()]);
  await expect(form).toBeHidden(T);
  const block = sheet.getByRole("region", { name: "Discounts and extras" });
  await expect(block.getByText("Senior citizen discount for JD")).toHaveCount(1, T);
  await expect(block.getByText("−₱10.00")).toHaveCount(1);
  await guest.context.close();
});

test("a receipt whose response was lost is saved once when the host taps Try again", async ({ page, browser }) => {
  test.slow();
  const { guest, sheet } = await pricedOrder(page, browser);
  await loseFirstResponse(page, /\/receipts\//);
  const check = sheet.getByRole("region", { name: "Check against the receipt" });
  await check.getByRole("button", { name: "Add another receipt" }).click();
  const drawer = page.getByRole("dialog", { name: "Add a receipt" });
  await drawer.getByLabel("Label").fill("Second receipt");
  await drawer.getByRole("checkbox", { name: /JD/ }).check();
  await drawer.getByLabel("Receipt total (₱)").fill("60");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByRole("alert")).toContainText("Not saved.", T);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/receipts/") && r.request().method() === "PUT", T), drawer.getByRole("button", { name: "Try again" }).click()]);
  await expect(drawer).toBeHidden(T);
  await expect(check.getByRole("region", { name: "Second receipt" })).toHaveCount(1, T);
  await guest.context.close();
});

async function openPayment(page: Page, sheet: ReturnType<Page["getByRole"]>) {
  await sheet.getByRole("button", { name: "Record payment" }).first().click();
  const drawer = page.getByRole("dialog", { name: /^Record payment from/ });
  await drawer.getByLabel(/^Amount/).fill("50");
  return drawer;
}

test("a payment whose response was lost is recorded once when the host taps Try again", async ({ page, browser }) => {
  test.slow();
  const { guest, sheet } = await pricedOrder(page, browser);
  await loseFirstResponse(page, /\/payments\//);
  const drawer = await openPayment(page, sheet);
  await drawer.getByRole("button", { name: /^Record/ }).click();
  await expect(drawer).toContainText("Not saved", T);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/payments/") && r.request().method() === "PUT", T), drawer.getByRole("button", { name: "Try again" }).click()]);
  await expect(drawer).toBeHidden(T);
  await expect(sheet.getByRole("region", { name: "Payments" })).toContainText("₱50.00 of", T);
  await guest.context.close();
});

test("a payment recorded offline is sent when the connection returns, once", async ({ page, browser, context }) => {
  test.slow();
  const { guest, sheet } = await pricedOrder(page, browser);
  const drawer = await openPayment(page, sheet);
  await context.setOffline(true);
  await drawer.getByRole("button", { name: /^Record/ }).click();
  await expect(drawer).toContainText("Not saved", T);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/payments/") && r.request().method() === "PUT" && r.ok(), T), context.setOffline(false)]);
  await expect(drawer).toBeHidden(T);
  await expect(sheet.getByRole("region", { name: "Payments" })).toContainText("₱50.00 of", T);
  await guest.context.close();
});

test("a dish queued offline is refused after the host ends the order, and can be discarded", async ({ page, browser }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Chicken Katsu");
  await guest.context.setOffline(true);
  await addDish(guest.page, "Halo-halo");
  await confirmRound1(page);
  await endOrder(page);

  await guest.context.setOffline(false);
  await guest.page.evaluate(() => window.dispatchEvent(new Event("online")));
  const alert = guest.page.getByRole("alert").filter({ hasText: "Not saved" });
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await alert.getByRole("button", { name: /^Discard/ }).click();
  await expect(alert).toHaveCount(0, T);
  const id = new URL(page.url()).pathname.split("/").pop();
  const snap = (await api(page, `/api/sessions/${id}/sync`)).data;
  expect(snap.entries.map((e: { dishName: string }) => e.dishName)).not.toContain("Halo-halo");
  await guest.context.close();
});

for (const lostAnswer of [false, true]) {
  test(`a served tap ${lostAnswer ? "whose response was lost" : "that never reached the server"} survives a reload and counts once`, async ({ page }) => {
    test.slow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startOrder(page);
    await addDish(page, "Sisig", 3);
    await confirmRound1(page);
    const row = () => page.getByTestId("served-section").getByRole("listitem").filter({ hasText: "Sisig" });

    let blocking = true;
    await page.route(/\/serving$/, async (route) => {
      if (!blocking) return route.continue();
      if (lostAnswer) await route.fetch();
      await route.abort("failed");
    });
    await row().getByRole("button", { name: "One more Sisig served" }).click();
    await expect(row().getByRole("alert")).toContainText("Couldn’t save this.", T);

    blocking = false;
    await Promise.all([page.waitForResponse((r) => r.url().endsWith("/serving") && r.ok(), T), page.reload()]);
    await expect(row()).toContainText("1 of 3 served", T);
    await expect(row().getByRole("alert")).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("salo:served:")))).toEqual([]);
  });
}
