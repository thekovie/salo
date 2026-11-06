import { expect, test, type Browser } from "@playwright/test";
import { addDish, inviteCode, startOrder } from "./support/helpers";

/** A browser that has never seen Salo: no tour flags. */
async function freshPage(browser: Browser) {
  const context = await browser.newContext({ ...test.info().project.use, storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

test("a first-time host is offered the tour, walks it, and can replay it from order options", async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  await startOrder(page);
  const offer = page.getByRole("region", { name: "Tour offer" });
  await expect(offer).toContainText("New to Salo?");
  await offer.getByRole("button", { name: "Show me" }).click();

  const card = page.getByRole("dialog");
  const titles = ["Type what people call out", "Who’s it for?", "Let the table add their own", "Check it, then show the waiter", "Name, cancel or end"];
  for (const [i, title] of titles.entries()) {
    await expect(card.getByRole("heading", { name: title })).toBeVisible();
    await expect(card).toContainText(`${i + 1} of ${titles.length}`);
    await card.getByRole("button", { name: i === titles.length - 1 ? "Done" : "Next" }).click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Seen: no offer after a reload. Replay from the host's order options; Escape closes it.
  await page.reload();
  await expect(page.getByRole("region", { name: "Tour offer" })).toHaveCount(0);
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: /How Salo works/ }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Type what people call out" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Who’s it for?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await context.close();
});

test("a first-time guest gets the guest tour; Not now hides the offer; the ? button replays it", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Gyoza");
  const code = await inviteCode(page);

  const { context, page: guest } = await freshPage(browser);
  await guest.goto(`/j/${code}`);
  await guest.getByLabel("Your name").fill("JD");
  await guest.getByRole("button", { name: "Join the order" }).click();
  // The offer waits until the "You're in!" tip has had its moment.
  const offer = guest.getByRole("region", { name: "Tour offer" });
  await expect(offer).toBeVisible({ timeout: 10_000 });
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toHaveCount(0);

  await guest.getByRole("button", { name: "How Salo works" }).click();
  const card = guest.getByRole("dialog");
  await expect(card.getByRole("heading", { name: "Add your dishes" })).toBeVisible();
  await expect(card).toContainText("1 of 5");
  for (let i = 0; i < 4; i++) await card.getByRole("button", { name: "Next" }).click();
  await expect(card.getByRole("heading", { name: "Need this again?" })).toBeVisible();
  await card.getByRole("button", { name: "Done" }).click();
  await expect(guest.getByRole("dialog")).toHaveCount(0);
  await context.close();
});

test("the landing page shows the four steps with their pictures", async ({ page }) => {
  await page.goto("/");
  for (const title of ["Start, then invite the table", "Everyone adds their own", "Hand the waiter one ticket", "Settle up later"]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/#how-it-works$/);
});
