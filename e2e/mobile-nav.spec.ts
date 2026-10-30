import { expect, test, type Page } from "./fixtures";

/**
 * The phone's bottom bar: the current tab is highlighted, and the Admin's
 * other screens and Log out sit behind "More". Needs a seeded dev deployment.
 */
const seedPassword = process.env.E2E_SEED_PASSWORD;
const ADMIN_PHONE = "9000000001";

test.skip(!seedPassword, "Set E2E_SEED_PASSWORD (the DEV_SEED_PASSWORD of a seeded dev deployment).");
test.skip(({ isMobile }) => !isMobile, "Phone only.");

async function signIn(page: Page, phone: string) {
  await page.goto("/signin");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(seedPassword!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

test("the bottom bar shows where you are; More holds Staff, Menu, Reports, Settings and Log out", async ({ page }) => {
  await signIn(page, ADMIN_PHONE);
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  // Log out isn't in the header on phones.
  await expect(page.getByRole("banner").getByRole("button", { name: "Log out" })).toBeHidden();

  await bar.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  for (const name of ["Staff", "Menu", "Reports", "Settings"]) await expect(sheet.getByRole("link", { name })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Log out" })).toBeVisible();
  await sheet.getByRole("link", { name: "Staff" }).click();
  await expect(page.getByRole("heading", { name: "Staff", level: 1 })).toBeVisible();
  await expect(bar.getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");

  // The bar stays at the bottom of the screen, and nothing scrolls sideways.
  await page.mouse.wheel(0, 4000);
  const box = (await bar.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await bar.getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/signin$/);
});
