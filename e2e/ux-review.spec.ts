import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { addDish, inviteCode } from "./support/helpers";

// UI/UX review pass for the landing scenes and the first-time tour. Skipped unless UX_REVIEW=1:
//   UX_REVIEW=1 pnpm e2e e2e/ux-review.spec.ts
// Screenshots and a findings report land in .impeccable/review/ux (git-ignored).
test.skip(!process.env.UX_REVIEW, "set UX_REVIEW=1 to run the UI/UX review captures");
test.describe.configure({ mode: "serial" });

const DIR = ".impeccable/review/ux";
const findings: { where: string; check: string; ok: boolean; detail?: string }[] = [];
const note = (where: string, check: string, ok: boolean, detail?: string) => findings.push({ where, check, ok, detail });

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 640 };
const DESKTOP = { width: 1280, height: 900 };

async function context(browser: Browser, opts: { viewport: { width: number; height: number }; dark?: boolean; reduced?: boolean; fresh?: boolean; mobile?: boolean }) {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: opts.viewport,
    deviceScaleFactor: 2,
    isMobile: opts.mobile ?? opts.viewport.width < 800,
    hasTouch: opts.mobile ?? opts.viewport.width < 800,
    colorScheme: opts.dark ? "dark" : "light",
    reducedMotion: opts.reduced ? "reduce" : "no-preference",
    storageState: opts.fresh ? { cookies: [], origins: [] } : test.info().project.use.storageState,
  });
  return { ctx, page: await ctx.newPage() };
}

async function noOverflow(page: Page, where: string) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  note(where, "no horizontal scroll", sw <= iw, `scrollWidth ${sw} vs ${iw}`);
}

async function axe(page: Page, where: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  note(where, "axe WCAG 2.2 AA", result.violations.length === 0, result.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ") || undefined);
}

/** Scroll the whole page slowly so every scene plays, then back to the top. */
async function playScenes(page: Page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 300) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(3500);
}

for (const [label, viewport, dark] of [
  ["landing-phone-light", PHONE, false],
  ["landing-phone-dark", PHONE, true],
  ["landing-small-light", SMALL, false],
  ["landing-desktop-light", DESKTOP, false],
  ["landing-desktop-dark", DESKTOP, true],
] as const) {
  test(label, async ({ browser }) => {
    const { ctx, page } = await context(browser, { viewport, dark });
    await page.goto("/");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}/${label}-hero.png` });
    await playScenes(page);
    await noOverflow(page, label);
    await axe(page, label);
    await page.screenshot({ path: `${DIR}/${label}-full.png`, fullPage: true });
    // Hero mid-loop frames: does the animation read?
    if (viewport === PHONE && !dark) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      for (const t of [1500, 3600, 6500]) {
        await page.waitForTimeout(t === 1500 ? 1500 : t - (t === 3600 ? 1500 : 3600));
        await page.locator("figure").first().screenshot({ path: `${DIR}/hero-frame-${t}.png` });
      }
    }
    await ctx.close();
  });
}

test("landing with reduced motion shows finished scenes", async ({ browser }) => {
  const { ctx, page } = await context(browser, { viewport: PHONE, reduced: true });
  await page.goto("/");
  await page.waitForTimeout(600);
  const stamps = await page.getByText("Confirmed", { exact: true }).count();
  note("landing-reduced", "final frames shown (stamps visible)", stamps >= 2, `${stamps} stamps`);
  await page.screenshot({ path: `${DIR}/landing-reduced-full.png`, fullPage: true });
  await ctx.close();
});

async function walkTour(page: Page, where: string, expected: number) {
  const card = page.getByRole("dialog");
  await expect(card).toBeVisible();
  for (let i = 0; i < expected; i++) {
    await page.waitForTimeout(500); // spotlight settles after scrolling
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
      const frame = [...document.querySelectorAll<HTMLElement>("div[aria-hidden].fixed")].find((el) => el.style.boxShadow)?.getBoundingClientRect();
      const buttons = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent?.trim() || b.getAttribute("aria-label"), w: Math.round(r.width), h: Math.round(r.height) };
      });
      return { dialog: { top: dialog.top, bottom: dialog.bottom, left: dialog.left, right: dialog.right }, frame: frame && { top: frame.top, bottom: frame.bottom }, vh: window.innerHeight, vw: window.innerWidth, buttons, focus: document.activeElement?.textContent?.trim() };
    });
    const title = await card.getByRole("heading").textContent();
    const step = `${where} step ${i + 1} "${title}"`;
    note(step, "card inside the viewport", geometry.dialog.top >= 0 && geometry.dialog.bottom <= geometry.vh && geometry.dialog.left >= 0 && geometry.dialog.right <= geometry.vw, JSON.stringify(geometry.dialog));
    if (geometry.frame) {
      const overlaps = geometry.dialog.top < geometry.frame.bottom && geometry.dialog.bottom > geometry.frame.top;
      note(step, "card does not cover the spotlight", !overlaps, `card ${Math.round(geometry.dialog.top)}–${Math.round(geometry.dialog.bottom)}, spot ${Math.round(geometry.frame.top)}–${Math.round(geometry.frame.bottom)}`);
      note(step, "spotlight inside the viewport", geometry.frame.top >= 0 && geometry.frame.bottom <= geometry.vh, JSON.stringify(geometry.frame));
    } else note(step, "spotlight found", false);
    const small = geometry.buttons.filter((b) => b.w < 44 || b.h < 44);
    note(step, "card buttons ≥ 44 px", small.length === 0, small.map((b) => `${b.text} ${b.w}×${b.h}`).join(", ") || undefined);
    note(step, "focus on the primary button", geometry.focus === "Next" || geometry.focus === "Done", `focus: ${geometry.focus}`);
    await page.screenshot({ path: `${DIR}/${where}-step-${i + 1}.png` });
    if (i === 0) await axe(page, `${step} (tour open)`);
    await card.getByRole("button", { name: i === expected - 1 ? "Done" : "Next" }).click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

for (const [label, viewport, dark] of [
  ["host-phone-light", PHONE, false],
  ["host-phone-dark", PHONE, true],
  ["host-small", SMALL, false],
] as const) {
  test(`tour: ${label}`, async ({ browser }) => {
    const { ctx, page } = await context(browser, { viewport, dark, fresh: true });
    await page.goto("/");
    await page.getByRole("button", { name: "Start an order" }).click();
    await page.waitForURL(/\/s\//);
    await addDish(page, "Chicken Katsu", 2);
    await addDish(page, "Gyoza");
    const offer = page.getByRole("region", { name: "Tour offer" });
    await expect(offer).toBeVisible();
    await page.screenshot({ path: `${DIR}/${label}-offer.png` });
    await noOverflow(page, `${label} workspace with offer`);
    await axe(page, `${label} offer`);
    await offer.getByRole("button", { name: "Show me" }).click();
    await walkTour(page, label, 5);
    await ctx.close();
  });
}

test("tour: guest phone", async ({ browser }) => {
  const host = await context(browser, { viewport: PHONE });
  await host.page.goto("/");
  await host.page.getByRole("button", { name: "Start an order" }).click();
  await host.page.waitForURL(/\/s\//);
  await addDish(host.page, "Sisig");
  const code = await inviteCode(host.page);
  const guest = await context(browser, { viewport: PHONE, fresh: true });
  await guest.page.goto(`/i/${code}`);
  await guest.page.getByLabel("Your name").fill("JD");
  await guest.page.getByRole("button", { name: "Join the order" }).click();
  await guest.page.waitForTimeout(1200);
  await guest.page.screenshot({ path: `${DIR}/guest-joined-tip.png` });
  const offer = guest.page.getByRole("region", { name: "Tour offer" });
  await expect(offer).toBeVisible({ timeout: 10_000 });
  await guest.page.screenshot({ path: `${DIR}/guest-offer.png` });
  await offer.getByRole("button", { name: "Show me" }).click();
  await walkTour(guest.page, "guest-phone", 5);
  await host.ctx.close();
  await guest.ctx.close();
});

test.afterAll(async () => {
  await mkdir(DIR, { recursive: true });
  const failed = findings.filter((f) => !f.ok);
  const lines = [`# UX review: ${findings.length} checks, ${failed.length} failed`, "", ...failed.map((f) => `- FAIL ${f.where} · ${f.check}${f.detail ? ` · ${f.detail}` : ""}`), "", "## Passed", ...findings.filter((f) => f.ok).map((f) => `- ok ${f.where} · ${f.check}${f.detail ? ` · ${f.detail}` : ""}`)];
  await writeFile(`${DIR}/report.md`, lines.join("\n"));
});
