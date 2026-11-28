import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Arrival pills and tags (and the landing demo that loops them) fade in and out; axe mid-fade reads the blended colour as low contrast.
const FADING = ".arrival-pill, .arrival-tag";
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** WCAG 2.2 AA axe pass over the page (or `include`) in light and dark; zero violations expected. */
export async function axeClean(page: Page, opts: { include?: string; label?: string } = {}) {
  // Toasts sit over the page until they unmount (ARRIVAL_MS); axe reads whatever they cover as obscured.
  await expect(page.locator("[data-toast-stack] .arrival-pill")).toHaveCount(0, { timeout: 15_000 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // The theme swap runs colour transitions; axe mid-transition reads blended colours as low contrast.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    let builder = new AxeBuilder({ page }).withTags(TAGS).exclude(FADING);
    if (opts.include) builder = builder.include(opts.include);
    const { violations } = await builder.analyze();
    const message = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(" ")}\n  ${n.failureSummary}`).join("\n")}`).join("\n\n");
    expect(violations, `axe ${opts.label ?? "page"} [${scheme}]\n${message}`).toEqual([]);
  }
}

/** No sideways scroll: the page is no wider than the viewport. A failure names the widest offenders. */
export async function expectNoOverflow(page: Page, label = "page") {
  const { scrollWidth, clientWidth, wide } = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
      .slice(0, 6)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} "${(e.textContent ?? "").slice(0, 30)}"`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth, wide };
  });
  expect(scrollWidth, `${label} overflows sideways: ${wide.join(" | ")}`).toBeLessThanOrEqual(clientWidth);
}
