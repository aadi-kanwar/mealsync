import { expect, test, type Page } from "@playwright/test";

/**
 * Master prompt E2E 1 (Phase 1 part): a new user signs up, completes their
 * profile, sees "waiting for approval"; the Warden approves them; they then
 * see they're approved. Needs a seeded development Convex deployment.
 * (Submitting meals is added in Phase 2.)
 */
const seedPassword = process.env.E2E_SEED_PASSWORD;
const WARDEN_PHONE = "9000000002"; // TEST Warden from `npx convex run seed:dev`

test.skip(!seedPassword, "Set E2E_SEED_PASSWORD (the DEV_SEED_PASSWORD of a seeded dev deployment).");
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, phone: string, password: string) {
  await page.goto("/signin");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("new sign-up waits for approval, then the Warden approves them", async ({ browser }) => {
  // A fresh, valid-looking Indian mobile number for every run.
  const phone = `7${String(Date.now()).slice(-9)}`;
  const name = `E2E Person ${phone.slice(-4)}`;
  const password = "e2e-test-pass";

  const residentContext = await browser.newContext();
  const resident = await residentContext.newPage();
  await resident.goto("/signin");
  await resident.getByRole("tab", { name: "Create account" }).click();
  await resident.getByLabel("Mobile number").fill(phone);
  await resident.getByLabel("Password", { exact: true }).fill(password);
  await resident.getByLabel("Type the password again").fill(password);
  await resident.getByRole("button", { name: "Create account" }).click();

  await expect(resident.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await resident.getByLabel("Full name").fill(name);
  await resident.getByLabel("Room number").fill("E2E-1");
  await resident.getByRole("button", { name: "Continue" }).click();
  await expect(resident.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();

  // A pending resident can't open staff screens.
  await resident.goto("/staff/signups");
  await expect(resident.getByText("This area is for PG staff only.")).toBeVisible();
  await resident.goto("/pending");

  const wardenContext = await browser.newContext();
  const warden = await wardenContext.newPage();
  await signIn(warden, WARDEN_PHONE, seedPassword!);
  await expect(warden).toHaveURL(/\/staff$/);
  await warden.goto("/staff/signups");
  const row = warden.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  const dialog = warden.getByRole("dialog");
  await dialog.getByLabel("Room number").fill("E2E-2");
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(row).toHaveCount(0);

  // The resident's open "waiting" screen moves on by itself.
  await expect(resident.getByRole("heading", { name: `Hello, ${name}` })).toBeVisible({ timeout: 15_000 });
  await expect(resident.getByText("Room E2E-2")).toBeVisible();

  await residentContext.close();
  await wardenContext.close();
});

test("wrong password shows a plain message", async ({ page }) => {
  await signIn(page, WARDEN_PHONE, "definitely-wrong");
  await expect(page.getByText("That phone number and password didn't work.", { exact: false })).toBeVisible();
});
