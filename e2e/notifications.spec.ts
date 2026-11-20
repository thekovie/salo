import { expect, test } from "@playwright/test";
import { addDish, confirmRound1, inviteCode, joinAsGuest, startOrder } from "./support/helpers";

const SLOW = { timeout: 15_000 };

test("scenario C: a confirmed dish goes unavailable; the guest's bell goes up live and the update leads to Rounds", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Sisig");
  await addDish(guest.page, "Sisig");
  await expect(guest.page.getByRole("button", { name: "Updates", exact: true })).toBeVisible();

  // Round confirmed: the guest hears it, the host (who did it) does not.
  await confirmRound1(page);
  const bell = guest.page.getByRole("button", { name: /^Updates/ });
  await expect(guest.page.getByRole("button", { name: "Updates, 1 unread" })).toBeVisible(SLOW);
  await expect(page.getByRole("button", { name: "Updates", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /Rounds/ }).click();
  await page.getByRole("button", { name: /Change a dish/ }).click();
  await page.getByRole("dialog", { name: "Change a dish" }).getByRole("button", { name: "Sisig ×2" }).click();
  const sheet = page.getByRole("dialog", { name: /Change Sisig/ });
  await sheet.getByRole("radio", { name: "Unavailable" }).click();
  await expect(sheet.getByText("JD gets an update.")).toBeVisible();
  await sheet.getByRole("button", { name: "Mark unavailable" }).click();
  await page.getByRole("dialog", { name: "Mark Sisig unavailable?" }).getByRole("button", { name: "Mark unavailable" }).click();
  await expect(page.getByText("Sisig marked unavailable · 2 cancelled.")).toBeVisible(SLOW);

  await expect(guest.page.getByRole("button", { name: "Updates, 2 unread" })).toBeVisible(SLOW);
  await bell.click();
  const drawer = guest.page.getByRole("dialog", { name: "Updates" });
  await expect(drawer.getByRole("button", { name: /Sisig is unavailable · 1 cancelled from your order/ })).toBeVisible();
  await expect(drawer.getByText("New", { exact: true })).toHaveCount(2);
  await drawer.getByRole("button", { name: /Sisig is unavailable/ }).click();
  await expect(guest.page.getByRole("tab", { name: /Rounds/ })).toHaveAttribute("aria-selected", "true");
  await expect(guest.page.getByRole("button", { name: "Updates, 1 unread" })).toBeVisible();
  await guest.context.close();
});

test("mark all read clears the badge and the drawer is readable after the order ends", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startOrder(page);
  const guest = await joinAsGuest(browser, await inviteCode(page), "JD");
  await addDish(page, "Gyoza");
  await confirmRound1(page);
  await expect(guest.page.getByRole("button", { name: "Updates, 1 unread" })).toBeVisible(SLOW);

  await guest.page.getByRole("button", { name: /^Updates/ }).click();
  const drawer = guest.page.getByRole("dialog", { name: "Updates" });
  await expect(drawer.getByText("Round 1 confirmed with the waiter")).toBeVisible();
  const order = await drawer.getByRole("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim()));
  expect(order.slice(0, 3)).toEqual(["Mark all read", "Close", expect.stringContaining("Round 1 confirmed")]);
  await drawer.getByRole("button", { name: "Mark all read" }).click();
  await expect(drawer.getByText("New", { exact: true })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(guest.page.getByRole("button", { name: "Updates", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Order options" }).click();
  await page.getByRole("button", { name: "End order" }).click();
  await page.getByRole("dialog", { name: "End this order?" }).getByRole("button", { name: "Yes, end the order" }).click();
  await expect(guest.page.getByRole("button", { name: "Updates, 1 unread" })).toBeVisible(SLOW);
  await guest.page.getByRole("button", { name: /^Updates/ }).click();
  await expect(guest.page.getByRole("dialog", { name: "Updates" }).getByText("The host ended the order")).toBeVisible();
  await guest.context.close();
});
