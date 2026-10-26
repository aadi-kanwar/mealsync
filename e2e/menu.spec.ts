import { expect, test, type Page } from "@playwright/test";
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
  // Tomorrow's weekday, filled the same in both menus so the rotation doesn't matter.
  const weekday = formatInTimeZone(new Date(Date.now() + 86_400_000), "Asia/Kolkata", "EEEE");
  const dish = `Test thali ${Date.now() % 100000}`;

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, ADMIN_PHONE);
  await expect(admin).toHaveURL(/\/staff$/);
  await admin.goto("/staff/menu");
  for (const label of ["A", "B"]) {
    await admin.getByRole("tab", { name: new RegExp(`^Menu ${label}`) }).click();
    await admin.getByLabel(`Menu ${label}, ${weekday}, Lunch`).fill(dish);
  }
  await expect(admin.getByText("Unsaved changes in Menu A and Menu B")).toBeVisible();
  await admin.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("All changes saved.")).toBeVisible();
  const thisWeek = admin.getByRole("group", { name: "This week's menu" });
  await thisWeek.getByRole("button", { name: "Menu A" }).click();
  await expect(thisWeek.getByRole("button", { name: "Menu A" })).toHaveAttribute("aria-pressed", "true");
  await expect(admin.getByText("Next week: Menu B.", { exact: false })).toBeVisible();
  await adminContext.close();

  const context = await browser.newContext();
  const resident = await context.newPage();
  await signIn(resident, RESIDENT_PHONE);
  await expect(resident.getByRole("heading", { name: /^Tomorrow/ })).toBeVisible();
  await expect(resident.getByText(dish)).toBeVisible();
  await expect(resident.getByText("12:00 – 2:00 PM")).toBeVisible();
  await context.close();
});
