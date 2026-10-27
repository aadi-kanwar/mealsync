import { expect, test, type Page } from "@playwright/test";
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
  await expect(page.getByRole("heading", { name: "PG details" })).toBeVisible();

  await sections.getByRole("button", { name: "Meal times & deadline" }).click();
  await expect(page).toHaveURL(/section=meals/);
  await expect(page.getByLabel("Starts").first()).toHaveValue("07:30");
  await expect(page.getByLabel("Time", { exact: true })).toHaveValue("06:00");

  await sections.getByRole("button", { name: "Phone reminders" }).click();
  await expect(page.getByLabel("Send reminders")).toBeChecked();
  const times = page.getByLabel(/^Reminder \d$/);
  const removeTestTime = async () => {
    const values = await times.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    const i = values.indexOf("19:30");
    if (i === -1) return false;
    await page.getByRole("button", { name: `Remove reminder ${i + 1}` }).click();
    await page.getByRole("button", { name: "Save reminders" }).click();
    await expect(page.getByText("Reminders go out at the new times.").first()).toBeVisible();
    return true;
  };
  await removeTestTime(); // left over from an interrupted run
  await expect(times.first()).toBeVisible();
  const before = await times.count();
  await page.getByRole("button", { name: "Add a time" }).click();
  await times.nth(before).fill("19:30");
  await page.getByRole("button", { name: "Save reminders" }).click();
  await expect(page.getByText("Reminders go out at the new times.").first()).toBeVisible();
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
  expect(file.suggestedFilename()).toMatch(/^dine-report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("Date,Day,Meal,Status,Residents counted,Yes,No,Not answered,Answered");
  expect(csv.trim().split("\r\n").length).toBeGreaterThan(1);

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
