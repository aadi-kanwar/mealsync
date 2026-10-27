import { expect, test, type Page } from "@playwright/test";

/**
 * The "Add to home screen" and "Turn on meal reminders" pop-ups.
 * Needs a seeded development Convex deployment.
 */
const seedPassword = process.env.E2E_SEED_PASSWORD;
const RESIDENT_PHONE = "9000000004"; // TEST Resident A
const WARDEN_PHONE = "9000000002";

test.skip(!seedPassword, "Set E2E_SEED_PASSWORD (the DEV_SEED_PASSWORD of a seeded dev deployment).");

// Headless browsers block notifications outright; act like a phone that hasn't been asked yet.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if ("Notification" in window) Object.defineProperty(Notification, "permission", { get: () => "default" });
  });
});

async function signIn(page: Page, phone: string) {
  await page.goto("/signin");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(seedPassword!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const install = (page: Page) => page.getByRole("dialog", { name: "Add Dine to your home screen" });
const reminders = (page: Page) => page.getByRole("dialog", { name: "Turn on meal reminders" });

test("on a phone: add to home screen first, then reminders; back on every visit", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  await signIn(page, RESIDENT_PHONE);
  await expect(install(page)).toBeVisible();
  await expect(install(page).getByText("Install app")).toBeVisible();
  await install(page).getByRole("button", { name: "Not now" }).click();
  await expect(install(page)).toHaveCount(0);
  await expect(reminders(page)).toBeVisible();
  await reminders(page).getByRole("button", { name: "Not now" }).click();
  await expect(reminders(page)).toHaveCount(0);

  // Same visit: not asked again.
  await page.goto("/upcoming");
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  await expect(install(page)).toHaveCount(0);
  await expect(reminders(page)).toHaveCount(0);

  // Next visit (the app opened again): asked again.
  const next = await page.context().newPage();
  await next.goto("/home");
  await expect(install(next)).toBeVisible();
  await next.close();
});

test("opened from the home screen icon: no install pop-up", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  await page.addInitScript(() => localStorage.setItem("dine-installed", "1"));
  await signIn(page, RESIDENT_PHONE);
  await expect(reminders(page)).toBeVisible();
  await expect(install(page)).toHaveCount(0);
});

test("staff get the install pop-up but not the reminders one", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone only.");
  await signIn(page, WARDEN_PHONE);
  await expect(page).toHaveURL(/\/staff$/);
  await expect(install(page)).toBeVisible();
  await install(page).getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("heading", { name: /Dashboard|Today|Tomorrow/ }).first()).toBeVisible();
  await expect(reminders(page)).toHaveCount(0);
});

test("on a computer without the browser's install option: only the reminders pop-up", async ({ page, isMobile }) => {
  test.skip(isMobile, "Computer only.");
  await signIn(page, RESIDENT_PHONE);
  await expect(reminders(page)).toBeVisible();
  await expect(install(page)).toHaveCount(0);
});
