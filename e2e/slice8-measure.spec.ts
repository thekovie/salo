import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { addDish, confirmRound1, inviteCode, joinAsGuest, openDetail, startOrder } from "./support/helpers";

// Slice 8 measurements and 320 px screenshots. Skipped unless MEASURE=1:
//   MEASURE=1 pnpm exec playwright test --project=mobile e2e/slice8-measure.spec.ts
// Output: .shots/slice8/ (git-ignored): numbers.json and four screenshots.
test.skip(!process.env.MEASURE, "set MEASURE=1 to run the slice 8 measurements");

const DIR = ".shots/slice8";
const dock = async (page: Page) => {
  await page.waitForTimeout(300); // the ResizeObserver publishes --dock-h a frame later
  return page.evaluate(() => Math.round(parseFloat(document.documentElement.style.getPropertyValue("--dock-h"))));
};
const bar = (page: Page) =>
  page.evaluate(() => {
    const dockEl = document.querySelector('[data-testid="round-total"]')?.closest(".fixed");
    const buttons = [...(dockEl?.querySelectorAll("button") ?? [])].filter((b) => !b.closest("form"));
    return {
      dock: Math.round(parseFloat(document.documentElement.style.getPropertyValue("--dock-h"))),
      buttons: buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent?.trim(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), clipped: b.scrollWidth > b.clientWidth };
      }),
    };
  });
const height = async (page: Page, selector: string) => Math.round((await page.locator(selector).first().boundingBox())?.height ?? -1);

test("dock heights, Served row heights and 320 screenshots", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await mkdir(DIR, { recursive: true });
  const numbers: Record<string, number | Record<string, number>> = {};
  const dish = page.getByRole("textbox", { name: "Dish" });

  await page.setViewportSize({ width: 320, height: 640 });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Chicken Katsu");
  await addDish(guest.page, "Iced Tea");
  await page.waitForTimeout(500);

  for (const width of [320, 375]) {
    const w = `w${width}`;
    await page.setViewportSize({ width, height: 640 });
    await guest.page.setViewportSize({ width, height: 640 });
    await page.waitForTimeout(300);
    const host: Record<string, number> = {};
    await dish.blur();
    host.rest = await dock(page);
    if (width === 320) await page.screenshot({ path: `${DIR}/composer-rest-320.png` });
    await dish.focus();
    host.focused = await dock(page);
    if (width === 320) await page.screenshot({ path: `${DIR}/composer-focused-320.png` });
    await dish.fill("Sisig");
    await openDetail(page, "Size");
    await page.getByRole("textbox", { name: "Size or variant" }).fill("Large");
    await openDetail(page, "Note");
    await page.getByRole("textbox", { name: "Instructions" }).fill("No sauce");
    host.detailsFilled = await dock(page);
    await dish.fill("");
    await page.getByRole("button", { name: /Remove size/ }).click();
    await page.getByRole("button", { name: /Remove note/ }).click();
    await page.mouse.click(5, 5);
    await dish.blur();
    numbers[`host_${w}`] = host;

    const guestDish = guest.page.getByRole("textbox", { name: "Dish" });
    const g: Record<string, number> = {};
    await guestDish.blur();
    g.rest = await dock(guest.page);
    await guestDish.focus();
    g.focused = await dock(guest.page);
    await guestDish.blur();
    numbers[`guest_${w}`] = g;
  }

  // Served rows and My share, at 320.
  await page.setViewportSize({ width: 320, height: 640 });
  await openDetail(page, "Price");
  await page.getByLabel("Price each (₱)").fill("120");
  await dish.fill("Pancit");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await dish.blur();
  await confirmRound1(page);
  const served = page.getByTestId("served-section");
  await page.getByRole("button", { name: /All served.*Chicken Katsu/ }).click();
  await page.getByText("Fully served (1)").waitFor({ timeout: 15_000 });
  const rows: Record<string, number> = {};
  rows.fullWaitingRow = await height(page, '[data-serve-group="waiting"]');
  await served.locator("details").evaluate((d) => ((d as HTMLDetailsElement).open = true));
  rows.compactFullyServedRow = await height(page, '[data-serve-group="done"]');
  numbers.served = rows;
  await served.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/served-320.png` });
  numbers.myShareDock = await dock(page);
  await page.getByRole("button", { name: /^((My )?share|Enter prices ·)/i }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/my-share-dock-320.png` });

  // Round 2+: host (My share + Review order) and guest (My share + I'm ready + Ticket), 320 and 375.
  await page.getByRole("button", { name: "Add more (round 2)" }).click();
  await addDish(page, "Halo-halo");
  await addDish(guest.page, "Leche Flan");
  await page.waitForTimeout(800);
  const round2: Record<string, unknown> = {};
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 640 });
    await guest.page.setViewportSize({ width, height: 640 });
    await page.waitForTimeout(400);
    await guest.page.waitForTimeout(400);
    round2[`host_${width}`] = await bar(page);
    round2[`guest_${width}`] = await bar(guest.page);
    for (const [who, p] of [["host", page], ["guest", guest.page]] as const) {
      await p.getByRole("textbox", { name: "Dish" }).focus();
      round2[`${who}_${width}_focused`] = await dock(p);
      await p.getByRole("textbox", { name: "Dish" }).blur();
    }
    if (width === 320) {
      await page.screenshot({ path: `${DIR}/round2-host-320.png` });
      await guest.page.screenshot({ path: `${DIR}/round2-guest-320.png` });
    }
  }
  numbers.round2 = round2 as never;

  await writeFile(`${DIR}/numbers.json`, JSON.stringify(numbers, null, 2));
  console.log(JSON.stringify(numbers));
});

// Follow-ups 22-24: Tab states and round-2 docks at several widths. Output: .shots/after-fu/ (screenshots, geometry, numbers).
const AFTER = ".shots/after-fu";
const MEASURE_ROWS = "/Users/kovie/Documents/claude skills custom/claude-workflow-main/skills/verify/references/measure-rows.js";
const capture = async (page: Page, stem: string) => {
  await page.screenshot({ path: `${AFTER}/${stem}.png` });
  await writeFile(`${AFTER}/${stem}.geometry.json`, JSON.stringify(await page.evaluate(await readFile(MEASURE_ROWS, "utf8"))));
};

test("follow-ups 22-24: Tab through the empty composer, round-2 docks", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await mkdir(AFTER, { recursive: true });
  const numbers: Record<string, unknown> = {};
  const dish = page.getByRole("textbox", { name: "Dish" });

  await page.setViewportSize({ width: 375, height: 700 });
  await startOrder(page);
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 700 });
    await dish.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await capture(page, `composer-tab-stepper-${width}`);
    await dish.blur();
    await page.mouse.click(5, 5);
  }

  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await openDetail(page, "Price");
  await page.getByLabel("Price each (₱)").fill(process.env.AMOUNT ?? "12480");
  await dish.fill("Whole lechon");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await dish.press("Escape");
  await addDish(guest.page, "Iced Tea");
  await confirmRound1(page);
  await page.getByRole("button", { name: "Add more (round 2)" }).click();
  await addDish(page, "Halo-halo");
  await addDish(guest.page, "Leche Flan");
  await page.waitForTimeout(800);

  for (const width of [320, 360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 700 });
    await guest.page.setViewportSize({ width, height: 700 });
    await page.waitForTimeout(400);
    numbers[`host_${width}`] = await bar(page);
    numbers[`guest_${width}`] = await bar(guest.page);
    if (width === 320) await capture(guest.page, "dock-round2-guest-320");
    if (width === 375 || width === 390) await capture(page, `dock-round2-host-${width}`);
  }
  await writeFile(`${AFTER}/numbers.json`, JSON.stringify(numbers, null, 2));
  console.log(JSON.stringify(numbers));
});

// D11: the incomplete labels ("Share so far ₱X", "Share · no prices yet") and the host's "Enter prices · n left" stay one row.
test("incomplete share labels stay on one row at 320 and 360", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const guest = await (async () => {
    await startOrder(page);
    return joinAsGuest(browser, await inviteCode(page), "JD");
  })();
  await addDish(page, "Sisig");
  await addDish(guest.page, "Iced Tea");
  await addDish(guest.page, "Sinigang");
  await expect(page.getByTestId("dish-row").filter({ hasText: "JD" })).toHaveCount(2, { timeout: 15_000 });
  await confirmRound1(page);
  const rows: Record<string, unknown> = {};
  const measure = async (who: string) => {
    for (const width of [320, 360]) {
      await page.setViewportSize({ width, height: 640 });
      await guest.page.setViewportSize({ width, height: 640 });
      await page.waitForTimeout(400);
      for (const [name, p] of [["host", page], ["guest", guest.page]] as const) {
        const b = await bar(p);
        rows[`${who}_${name}_${width}`] = b;
        for (const button of b.buttons) expect(button.h, `${who} ${name} ${width}: ${button.text}`).toBeLessThanOrEqual(48);
      }
    }
  };
  await measure("none");
  await page.getByRole("button", { name: /Enter prices ·/ }).click();
  const price = page.getByRole("dialog", { name: "Enter prices" }).getByRole("textbox", { name: "Price each for Iced Tea" });
  await price.fill("60");
  await price.press("Enter");
  await expect(guest.page.getByRole("button", { name: /Share so far ₱60/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("dialog", { name: "Enter prices" }).getByRole("button", { name: "Close" }).click();
  await measure("sofar");
  console.log(JSON.stringify(rows));
});
