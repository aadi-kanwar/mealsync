import { expect, newContext, test, type Page } from "./fixtures";
import { formatInTimeZone } from "date-fns-tz";

/**
 * The Admin fills in the weekly menus; residents see the dishes on their
 * meals. Needs a seeded development Convex deployment.
 */
const seedPassword = process.env.E2E_SEED_PASSWORD;
const ADMIN_PHONE = "9000000001";
const RESIDENT_PHONE = "9000000004"; // TEST Resident A

test.skip(!seedPassword, "Set E2E_SEED_PASSWORD (the DEV_SEED_PASSWORD of a seeded dev deployment).");

async function signIn(page: Page, phone: string) {
  await page.goto("/signin");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(seedPassword!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("admin's menu shows up on residents' meals", async ({ browser }) => {
  // Today's and tomorrow's weekdays (the home screen shows today before 6 AM),
  // filled the same in both menus so the rotation doesn't matter.
  const weekdays = [0, 1].map((d) => formatInTimeZone(new Date(Date.now() + d * 86_400_000), "Asia/Kolkata", "EEEE"));
  const thali = `Test thali ${Date.now() % 100000}`;
  // Typed as one line; residents see each dish as its own tag.
  const dish = `${thali}, raita`;

  const adminContext = await newContext(browser);
  const admin = await adminContext.newPage();
  await signIn(admin, ADMIN_PHONE);
  await expect(admin).toHaveURL(/\/staff$/);
  await admin.goto("/staff/menu");
  // The menu is set per property: choose the residents' one.
  await admin.getByRole("button", { name: "TEST PG (development)" }).click();
  for (const label of ["A", "B"]) {
    await admin.getByRole("tab", { name: new RegExp(`^Menu ${label}`) }).click();
    for (const weekday of weekdays) await admin.getByLabel(`Menu ${label}, ${weekday}, Lunch`).fill(dish);
  }
  await expect(admin.getByText("Unsaved changes in Menu A and Menu B")).toBeVisible();
  await admin.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("All changes saved.")).toBeVisible();
  const thisWeek = admin.getByRole("group", { name: "This week's menu" });
  await thisWeek.getByRole("button", { name: "Menu A" }).click();
  await expect(thisWeek.getByRole("button", { name: "Menu A" })).toHaveAttribute("aria-pressed", "true");
  await expect(admin.getByText("Next week: Menu B.", { exact: false })).toBeVisible();
  await adminContext.close();

  const context = await newContext(browser);
  const resident = await context.newPage();
  await signIn(resident, RESIDENT_PHONE);
  await expect(resident.getByRole("heading", { name: /(Today|Tomorrow)/ })).toBeVisible();
  const lunchDishes = resident.getByRole("list", { name: "Lunch dishes" });
  await expect(lunchDishes.getByRole("listitem")).toHaveText([thali, "Raita"]);
  await expect(resident.getByText("12:00 – 2:00 PM")).toBeVisible();

  // The Menu tab: a menu card for the day, with each meal's dishes and the resident's choice.
  await resident.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Menu" }).click();
  await expect(resident.getByRole("heading", { name: "Menu", level: 1 })).toBeVisible();
  await expect(resident.getByRole("tab")).toHaveCount(7);
  const card = resident.getByRole("tabpanel");
  await expect(card.getByRole("list", { name: "Lunch dishes" }).getByRole("listitem")).toHaveText([thali, "Raita"]);
  await expect(card.getByRole("heading", { name: "Lunch" })).toBeVisible();
  await expect(card.getByText("Your choice:").first()).toBeVisible();
  // Another day: the card follows the tab chosen.
  const tabs = resident.getByRole("tab");
  await tabs.nth(5).click();
  await expect(tabs.nth(5)).toHaveAttribute("aria-selected", "true");
  await expect(card).toBeVisible();
  await context.close();
});

