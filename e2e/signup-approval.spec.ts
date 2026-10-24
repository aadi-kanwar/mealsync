import { expect, test, type Page } from "@playwright/test";
import { formatInTimeZone } from "date-fns-tz";

/**
 * Master prompt E2E 1 (Phase 1 part): a new user signs up, completes their
 * profile, sees "waiting for approval"; the Warden approves them; they then
 * see they're approved and can choose meals. Also covers E2E 2-4: submit all
 * four meals, change one before the cutoff, closed meals can't be changed,
 * and E2E 5: the Warden sees counts and non-responders. Needs a seeded
 * development Convex deployment.
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

  // The app allows 30 new sign-ups per hour (abuse protection). Many test
  // runs in one hour reach it; say so plainly instead of timing out.
  const welcome = resident.getByRole("heading", { name: /Welcome/ });
  const limited = resident.getByText(/Too many attempts/);
  await expect(welcome.or(limited)).toBeVisible();
  test.skip(await limited.isVisible(), "The hourly limit on new sign-ups was reached; run again later.");
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
  await expect(resident.getByText("Room E2E-2", { exact: false })).toBeVisible();

  // The day after tomorrow is always open (its cutoff is tomorrow evening),
  // whatever time of day the test runs.
  await resident.getByRole("link", { name: "This week" }).click();
  const dayAfter = formatInTimeZone(new Date(Date.now() + 2 * 86_400_000), "Asia/Kolkata", "EEE, d MMM");
  const day = resident.getByRole("region", { name: dayAfter });
  const choose = (meal: string, answer: "Yes" | "No") =>
    day.getByRole("radiogroup", { name: `${meal}: will you eat?` }).getByRole("radio", { name: answer });

  // E2E 2: submit all four meals.
  await choose("Breakfast", "Yes").click();
  await choose("Lunch", "Yes").click();
  await choose("Snacks", "No").click();
  await choose("Dinner", "Yes").click();
  await expect(resident.getByText("4 changes not saved yet")).toBeVisible();
  await resident.getByRole("button", { name: "Save" }).click();
  await expect(resident.getByText(/^Saved at \d/)).toBeVisible();

  // E2E 3: change a choice before the cutoff; it stays changed after a reload.
  await choose("Lunch", "No").click();
  await expect(resident.getByText("1 change not saved yet")).toBeVisible();
  await resident.getByRole("button", { name: "Save" }).click();
  await expect(resident.getByText(/^Saved at \d/)).toBeVisible();
  await resident.reload();
  await expect(choose("Lunch", "No")).toBeChecked();
  await expect(choose("Snacks", "No")).toBeChecked();
  await expect(choose("Breakfast", "Yes")).toBeChecked();

  // E2E 5: the Warden sees counts and who hasn't answered. The new resident
  // answered every meal two days ahead, but nothing three days ahead.
  const isoIn = (days: number) => formatInTimeZone(new Date(Date.now() + days * 86_400_000), "Asia/Kolkata", "yyyy-MM-dd");
  await warden.goto(`/staff?date=${isoIn(2)}`);
  const lunchCounts = warden.getByRole("region", { name: /^Lunch/ });
  await expect(lunchCounts.getByText("Eligible (N)")).toBeVisible();
  await expect(lunchCounts.getByText("Not answered (U)")).toBeVisible();
  await expect(warden.getByText("These counts don't add up")).toHaveCount(0);
  await warden.goto(`/staff/non-responders?date=${isoIn(2)}`);
  await expect(warden.getByRole("list", { name: "Lunch: not answered" })).toBeVisible();
  await expect(warden.getByText(name, { exact: true })).toHaveCount(0);
  await warden.goto(`/staff/non-responders?date=${isoIn(3)}`);
  await expect(warden.getByRole("list", { name: "Lunch: not answered" }).getByText(name, { exact: true })).toBeVisible();

  // E2E 4: today's meals have passed their cutoff and can't be changed.
  // (The server's own refusal is covered by the backend tests.)
  const today = resident.getByRole("region", { name: /^Today/ });
  await expect(today.getByText("Choices for this day are closed.", { exact: false })).toBeVisible();
  await expect(today.getByRole("radio")).toHaveCount(0);

  // History is reachable and shows a friendly screen for a brand-new resident.
  await resident.getByRole("link", { name: "History" }).click();
  await expect(resident.getByRole("heading", { name: "History" })).toBeVisible();

  await residentContext.close();
  await wardenContext.close();
});

test("wrong password shows a plain message", async ({ page }) => {
  await signIn(page, WARDEN_PHONE, "definitely-wrong");
  await expect(page.getByText("That phone number and password didn't work.", { exact: false })).toBeVisible();
});
