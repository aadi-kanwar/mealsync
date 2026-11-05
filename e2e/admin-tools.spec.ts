import { expect, newContext, test, type Page } from "./fixtures";
import { readFile } from "node:fs/promises";

/**
 * Admin-only Settings sections and Reports; the Warden editing a resident.
 * Needs a seeded development Convex deployment. Every change is put back.
 */
const seedPassword = process.env.E2E_SEED_PASSWORD;
const ADMIN_PHONE = "9000000001";
const WARDEN_PHONE = "9000000002";

test.skip(!seedPassword, "Set E2E_SEED_PASSWORD (the DEV_SEED_PASSWORD of a seeded dev deployment).");
// These change shared data (and put it back), so they run once, on desktop.
test.skip(({ isMobile }) => isMobile, "Runs on desktop only.");

async function signIn(page: Page, phone: string) {
  await page.goto("/signin");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(seedPassword!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

test("the Admin's settings are in sections; meal times, deadline and reminders can be changed", async ({ page }) => {
  await signIn(page, ADMIN_PHONE);
  await page.goto("/staff/settings");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  // Organisation first: its name and every property.
  await expect(page.getByRole("heading", { name: "Organisation", level: 2 })).toBeVisible();
  const properties = page.getByRole("list", { name: "Properties" });
  await expect(properties).toContainText("TEST PG (development)");
  await expect(properties).toContainText("TEST PG 2 (development)");

  // The rest is per property: asks for one while "All properties" is chosen.
  await sections.getByRole("button", { name: "PG details" }).click();
  await expect(page.getByRole("heading", { name: "Choose a property" })).toBeVisible();
  await page.getByLabel("Property", { exact: true }).selectOption({ label: "TEST PG (development)" });
  await expect(page.getByLabel("PG name")).toHaveValue("TEST PG (development)");

  await sections.getByRole("button", { name: "Meals & deadline" }).click();
  await expect(page).toHaveURL(/section=meals/);
  await expect(page.getByLabel("Meal name").first()).toHaveValue("Breakfast");
  await expect(page.getByLabel("Starts").first()).toHaveValue("07:30");
  await expect(page.getByLabel("Served").first()).toBeChecked();
  const breakfastDays = page.getByRole("group", { name: "Days Breakfast is served" });
  await expect(breakfastDays.getByRole("button", { name: "Sun" })).toHaveAttribute("aria-pressed", "true");
  // Each meal has its own deadline.
  const breakfastDeadline = page.getByRole("group", { name: "Breakfast's deadline" });
  await expect(breakfastDeadline.getByLabel("Time", { exact: true })).toHaveValue(/^\d\d:\d\d$/);
  await expect(page.getByRole("group", { name: /'s deadline$/ })).toHaveCount(4);
  await expect(page.getByLabel("Warn residents")).toHaveValue(/^\d+$/);
  // Editing enables Save; nothing is saved here (shared dev data).
  await expect(page.getByRole("button", { name: "Save meals" })).toBeDisabled();
  await breakfastDays.getByRole("button", { name: "Sun" }).click();
  await expect(page.getByRole("button", { name: "Save meals" })).toBeEnabled();

  await sections.getByRole("button", { name: "Phone reminders" }).click();
  await expect(page.getByLabel("Send reminders")).toBeChecked();
  const times = page.getByLabel(/^Reminder \d$/);
  const removeTestTime = async () => {
    const values = await times.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    const i = values.indexOf("19:30");
    if (i === -1) return false;
    await page.getByRole("button", { name: `Remove reminder ${i + 1}` }).click();
    await page.getByRole("button", { name: "Save reminders" }).click();
    await expect(page.getByText(/Reminders go out at the new times/).first()).toBeVisible();
    return true;
  };
  await removeTestTime(); // left over from an interrupted run
  await expect(times.first()).toBeVisible();
  const before = await times.count();
  await page.getByRole("button", { name: "Add a time" }).click();
  await times.nth(before).fill("19:30");
  await page.getByRole("button", { name: "Save reminders" }).click();
  await expect(page.getByText(/Reminders go out at the new times/).first()).toBeVisible();
  await page.reload();
  await expect(times).toHaveCount(before + 1);
  // Put it back.
  expect(await removeTestTime()).toBe(true);
  await page.reload();
  await expect(times).toHaveCount(before);

  await sections.getByRole("button", { name: "Resident messages" }).click();
  await expect(page.getByLabel("Question 1")).not.toHaveValue("");
  await expect(sections.getByRole("link", { name: "Design system" })).toBeVisible();
});

test("the Admin previews and downloads a report for chosen dates", async ({ page }) => {
  await signIn(page, ADMIN_PHONE);
  await page.getByRole("link", { name: "Reports" }).first().click();
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page.getByRole("cell", { name: "Breakfast" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const file = await download;
  // All properties: one file, a row per PG per meal per day.
  expect(file.suggestedFilename()).toMatch(/^dine-all-properties-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("Property,Date,Day,Meal,Status,Residents counted,Yes,No,Not answered,Answered");
  expect(csv).toContain("TEST PG 2 (development),");
  expect(csv.trim().split("\r\n").length).toBeGreaterThan(1);

  // One resident's report.
  await page.getByLabel("Report for").selectOption({ label: "TEST Resident A · Room 101 · TEST PG (development)" });
  await expect(page.getByRole("heading", { name: /^TEST Resident A ·/ })).toBeVisible();
  const own = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const ownFile = await own;
  expect(ownFile.suggestedFilename()).toMatch(/^dine-test-resident-a-/);
  const ownCsv = await readFile((await ownFile.path())!, "utf8");
  expect(ownCsv).toContain("Resident,Room,Property,Date,Day,Meal,Choice,Last saved");
  expect(ownCsv).toContain("TEST Resident A,101,");

  await page.getByLabel("From").fill("2026-01-01");
  await expect(page.getByText("A report can cover at most 100 days.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeDisabled();
});

test("the Warden has no Settings, Reports or Design system, and can correct a resident's room", async ({ page }) => {
  await signIn(page, WARDEN_PHONE);
  for (const name of ["Settings", "Reports", "Design system"]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await page.goto("/staff/settings");
  await expect(page.getByRole("heading", { name: "PG details" })).toHaveCount(0);

  await page.goto("/staff/residents");
  const row = page.getByRole("listitem").filter({ hasText: "TEST Resident B" });
  await row.getByRole("button", { name: /^Edit/ }).click();
  await page.getByLabel("Room", { exact: true }).fill("102A");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(row.getByText("Room 102A")).toBeVisible();
  // Put it back.
  await row.getByRole("button", { name: /^Edit/ }).click();
  await page.getByLabel("Room", { exact: true }).fill("102");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(row.getByText("Room 102", { exact: false })).toBeVisible();
  await expect(row.getByText("Room 102A")).toHaveCount(0);
});

test("the Admin creates a Warden's account; the Warden signs in with the temporary password and chooses their own; the Admin resets it", async ({ page, browser }) => {
  test.setTimeout(90_000); // Two people, two sign-ins, a password change and a reset.
  const phone = `5${String(Date.now()).slice(-9)}`;
  const name = `E2E Person ${phone.slice(-4)}`;
  await signIn(page, ADMIN_PHONE);
  await page.goto("/staff/team");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number", { exact: true }).fill(phone);
  await page.getByRole("checkbox", { name: "TEST PG (development)" }).first().check();
  await page.getByRole("button", { name: "Create Warden account" }).click();
  const shown = page.getByRole("dialog", { name: "Temporary password" });
  await expect(shown).toBeVisible({ timeout: 15_000 });
  const temporary = (await shown.getByText(/^[a-z2-9]{4}-[a-z2-9]{4}$/).textContent())!;
  await shown.getByRole("button", { name: "Done" }).click();
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText("Temporary password")).toBeVisible();

  // The Warden's first sign-in: straight to choosing their own password, then their dashboard.
  const wardenContext = await newContext(browser);
  const warden = await wardenContext.newPage();
  const wardenSignIn = async (password: string) => {
    // Right after a reset the phone still holds the ended login for a moment
    // (until its next check clears it), so the sign-in page may first send it on.
    await expect(async () => {
      await warden.goto("/signin");
      await expect(warden.getByLabel("Mobile number")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    await warden.getByLabel("Mobile number").fill(phone);
    await warden.getByLabel("Password", { exact: true }).fill(password);
    await warden.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  await wardenSignIn(temporary);
  await expect(warden.getByRole("heading", { name: "Choose a new password" })).toBeVisible({ timeout: 15_000 });
  await warden.getByLabel("New password", { exact: true }).fill("e2e-warden-pass");
  await warden.getByLabel("Type the new password again").fill("e2e-warden-pass");
  await warden.getByRole("button", { name: "Save new password" }).click();
  await expect(warden.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText("Temporary password")).toHaveCount(0);

  // Forgotten: the Admin resets it; the Warden's phone is signed out.
  await row.getByRole("button", { name: `Reset ${name}'s password` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
  const again = (await page.getByRole("dialog", { name: "Temporary password" }).getByText(/^[a-z2-9]{4}-[a-z2-9]{4}$/).textContent())!;
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(warden).toHaveURL(/\/signin$/, { timeout: 15_000 });
  await wardenSignIn(again);
  await expect(warden.getByRole("heading", { name: "Choose a new password" })).toBeVisible({ timeout: 15_000 });
  await wardenContext.close();
});
