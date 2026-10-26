import { expect, test, type Page } from "@playwright/test";
import { formatInTimeZone } from "date-fns-tz";

/**
 * Master prompt E2E 1 (Phase 1 part): a new user signs up, completes their
 * profile, sees "waiting for approval"; the Warden approves them; they then
 * see they're approved and can choose meals. Also covers E2E 2-4: submit all
 * four meals, change one before the cutoff, closed meals can't be changed,
 * and E2E 5: the Warden sees counts and each resident's responses. Needs a seeded
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
  // Name and room are asked once, on the same form.
  await resident.getByLabel("Full name").fill(name);
  await resident.getByLabel("Room number").fill("E2E-1");
  await resident.getByLabel("Mobile number").fill(phone);
  await resident.getByLabel("Password", { exact: true }).fill(password);
  await resident.getByLabel("Type the password again").fill(password);
  await resident.getByRole("button", { name: "Create account" }).click();

  // The app allows 30 new sign-ups per hour (abuse protection). Many test
  // runs in one hour reach it; say so plainly instead of timing out.
  const waiting = resident.getByRole("heading", { name: "Waiting for approval" });
  const limited = resident.getByText(/Too many attempts/);
  // Creating an account (password hashing + profile) can take a few seconds.
  await expect(waiting.or(limited)).toBeVisible({ timeout: 15_000 });
  test.skip(await limited.isVisible(), "The hourly limit on new sign-ups was reached; run again later.");
  await expect(resident.getByText("(room E2E-1)", { exact: false })).toBeVisible();

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
  await expect(resident.getByText(`Hello, ${name} · Room E2E-2`)).toBeVisible({ timeout: 15_000 });
  await expect(resident.getByRole("heading", { name: /^(Today|Tomorrow)/ })).toBeVisible();

  // The day after tomorrow is always open (its cutoff is tomorrow evening),
  // whatever time of day the test runs.
  await resident.getByRole("link", { name: "This week" }).click();
  const dayAfter = formatInTimeZone(new Date(Date.now() + 2 * 86_400_000), "Asia/Kolkata", "EEEE d MMMM");
  const pickDay = () => resident.getByRole("tab", { name: new RegExp(`^${dayAfter}:`) }).click();
  await pickDay();
  const day = resident.getByRole("tabpanel");
  await expect(day.getByRole("heading", { name: dayAfter })).toBeVisible();
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
  await pickDay();
  await expect(choose("Lunch", "No")).toBeChecked();
  await expect(choose("Snacks", "No")).toBeChecked();
  await expect(choose("Breakfast", "Yes")).toBeChecked();

  // E2E 5: the Warden sees counts and who hasn't answered. The new resident
  // answered every meal two days ahead, but nothing three days ahead.
  const isoIn = (days: number) => formatInTimeZone(new Date(Date.now() + days * 86_400_000), "Asia/Kolkata", "yyyy-MM-dd");
  await warden.goto(`/staff?date=${isoIn(2)}`);
  const lunchCounts = warden.getByRole("region", { name: /^Lunch/ });
  for (const label of ["Yes", "No", "Not answered"]) {
    await expect(lunchCounts.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(lunchCounts.getByText(/residents? counted for this meal/)).toBeVisible();
  await expect(warden.getByText("These numbers don't add up")).toHaveCount(0);
  // Responses: every resident's choices and when they last saved.
  const responseRow = () =>
    warden.getByRole("list", { name: "Residents' responses" }).getByRole("listitem").filter({ hasText: name });
  await warden.goto(`/staff/responses?date=${isoIn(2)}`);
  await expect(warden.getByRole("heading", { name: "Responses" })).toBeVisible();
  for (const [meal, choice] of [["Breakfast", "Yes"], ["Lunch", "No"], ["Snacks", "No"], ["Dinner", "Yes"]]) {
    await expect(responseRow().getByRole("img", { name: `${meal}: ${choice}` })).toBeVisible();
  }
  await expect(responseRow().getByText(/^Saved \d/)).toBeVisible();
  await warden.goto(`/staff/responses?date=${isoIn(3)}`);
  await expect(responseRow().getByRole("img", { name: "Lunch: not answered" })).toBeVisible();
  await expect(responseRow().getByText("Nothing saved")).toBeVisible();

  // E2E 4: after 6 AM (India time) today's meals have closed, so today isn't
  // offered for changes. (The server's own refusal is covered by the backend tests.)
  if (Number(formatInTimeZone(new Date(), "Asia/Kolkata", "H")) >= 6) {
    await expect(resident.getByRole("tab", { name: /^Today/ })).toHaveCount(0);
  }
  await expect(resident.getByRole("tab")).toHaveCount(7);

  // Profile shows the details given once at sign-up, a short history and log out.
  await resident.getByRole("link", { name: "Profile" }).click();
  await expect(resident.getByText(name, { exact: true })).toBeVisible();
  await expect(resident.getByText("E2E-2", { exact: true })).toBeVisible();
  await expect(resident.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(resident.getByText("No past days yet.")).toBeVisible();
  await expect(resident.getByRole("button", { name: "Log out" })).toBeVisible();

  // Moving out: the Warden sets a last day, then undoes it.
  await warden.goto("/staff/residents");
  await warden.getByLabel("Search by name or room").fill(name);
  const person = warden.getByRole("listitem").filter({ hasText: name });
  await person.getByRole("button", { name: "Moved out" }).click();
  await warden.getByRole("dialog").getByRole("button", { name: "Confirm move-out" }).click();
  await expect(person.getByText(/^Last day /)).toBeVisible();
  await person.getByRole("button", { name: "Undo move-out" }).click();
  await warden.getByRole("dialog").getByRole("button", { name: "Undo move-out" }).click();
  await expect(person.getByText(/^Last day /)).toHaveCount(0);

  // Forgotten password: the Warden resets it; the resident is signed out,
  // signs in with the temporary one and must choose a new password.
  await person.getByRole("button", { name: "Reset password" }).click();
  await warden.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
  const temporary = (await warden.getByRole("dialog").getByText(/^[a-z2-9]{4}-[a-z2-9]{4}$/).textContent())!;
  await warden.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(person.getByText("Temporary password")).toBeVisible();

  await expect(resident).toHaveURL(/\/signin$/, { timeout: 15_000 });
  await resident.getByLabel("Mobile number").fill(phone);
  await resident.getByLabel("Password", { exact: true }).fill(temporary);
  await resident.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(resident.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await resident.getByLabel("New password", { exact: true }).fill("e2e-new-pass");
  await resident.getByLabel("Type the new password again").fill("e2e-new-pass");
  await resident.getByRole("button", { name: "Save new password" }).click();
  await expect(resident.getByRole("heading", { name: /^(Today|Tomorrow)/ })).toBeVisible();
  await expect(person.getByText("Temporary password")).toHaveCount(0);

  await residentContext.close();
  await wardenContext.close();
});

test("wrong password shows a plain message", async ({ page }) => {
  await signIn(page, WARDEN_PHONE, "definitely-wrong");
  await expect(page.getByText("That phone number and password didn't work.", { exact: false })).toBeVisible();
});
