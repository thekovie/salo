import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser } from "@playwright/test";
import { addDish, inviteCode, startOrder } from "./support/helpers";

/** A browser that has never seen Salo: no guide flags. */
async function freshPage(browser: Browser) {
  const context = await browser.newContext({ ...test.info().project.use, storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

const HOST_TITLES = ["Set up your table", "Invite the table", "Type what people call out", "Who it’s for, sizes and prices", "See it by person and group", "Check it, then show the waiter", "Add-ons and fixes", "Settle up with KKB", "You’re all set"];

test("a first-time host gets the setup guide: names the table inside it, tries features, sees the checklist", async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const offer = page.getByRole("region", { name: "Tour offer" });
  await expect(offer).toContainText("New to Salo?");
  await offer.getByRole("button", { name: "Start guide" }).click();

  const guide = page.getByRole("dialog", { name: "How Salo works" });
  await expect(guide.getByRole("heading", { name: "Set up your table" })).toBeVisible();
  await expect(guide).toContainText(`Step 1 of ${HOST_TITLES.length}`);
  expect((await new AxeBuilder({ page }).include("dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

  // Step 1 sets the table up right here.
  await guide.getByLabel("Your name").fill("Kovie");
  await guide.getByLabel("Order name").fill("Mang Inasal");
  await guide.getByRole("button", { name: "Save" }).click();
  await expect(guide.getByText("Saved.")).toBeVisible();
  await expect(guide.getByText("Done", { exact: true })).toBeVisible();

  // Every step in order, with KKB's "Try it" explaining why it can't run yet.
  for (const [i, title] of HOST_TITLES.entries()) {
    await expect(guide.getByRole("heading", { name: title })).toBeVisible();
    await expect(guide).toContainText(`Step ${i + 1} of ${HOST_TITLES.length}`);
    if (title === "Settle up with KKB") {
      await expect(guide.getByRole("button", { name: "Try it" })).toBeDisabled();
      await expect(guide).toContainText("Add a dish first");
    }
    if (i < HOST_TITLES.length - 1) await guide.getByRole("button", { name: "Next" }).click();
  }
  const checklist = guide.getByRole("list", { name: "Your checklist" });
  await expect(checklist.getByRole("button", { name: /Name yourself and the order\s*Done/ })).toBeVisible();
  // "Show me" jumps back to that step; its "Try it" takes you there.
  await checklist.getByRole("button", { name: /Invite the table/ }).click();
  await guide.getByRole("button", { name: "Try it" }).click();
  await expect(page.getByRole("dialog", { name: "Invite the table" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Replay from Options; "Try it" on prices opens the composer's price field.
  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: /How Salo works/ }).click();
  await guide.getByRole("button", { name: "Step 4: Who it’s for, sizes and prices" }).click();
  await guide.getByRole("button", { name: "Try it" }).click();
  await expect(page.getByLabel("Price each (₱)")).toBeVisible();

  // Seen: no offer after a reload.
  await page.reload();
  await expect(page.getByRole("region", { name: "Tour offer" })).toHaveCount(0);
  await context.close();
});

test("a first-time guest gets the guest guide; Not now hides the offer; Help replays it", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  await addDish(page, "Gyoza");
  const code = await inviteCode(page);

  const { context, page: guest } = await freshPage(browser);
  await guest.goto(`/i/${code}`);
  await guest.getByLabel("Your name").fill("JD");
  await guest.getByRole("button", { name: "Join the order" }).click();
  // The offer waits until the "You're in!" tip has had its moment.
  const offer = guest.getByRole("region", { name: "Tour offer" });
  await expect(offer).toBeVisible({ timeout: 10_000 });
  await offer.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toHaveCount(0);

  await guest.getByRole("button", { name: "How Salo works" }).click();
  const guide = guest.getByRole("dialog", { name: "How Salo works" });
  await expect(guide.getByRole("heading", { name: "Add your dishes" })).toBeVisible();
  await expect(guide).toContainText("Step 1 of 6");
  await guest.keyboard.press("ArrowRight");
  await expect(guide.getByRole("heading", { name: "For someone? Know the price?" })).toBeVisible();
  for (let i = 0; i < 4; i++) await guide.getByRole("button", { name: "Next" }).click();
  await expect(guide.getByRole("heading", { name: "You’re all set" })).toBeVisible();
  await guide.getByRole("button", { name: "Finish" }).click();
  await expect(guest.getByRole("dialog", { name: "How Salo works" })).toHaveCount(0);
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
