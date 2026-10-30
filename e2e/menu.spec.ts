import { expect, newContext, test, type Page } from "./fixtures";
import { formatInTimeZone } from "date-fns-tz";
import ExcelJS from "exceljs";

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
  const dish = `Test thali ${Date.now() % 100000}`;

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
  await expect(resident.getByText(dish)).toBeVisible();
  await expect(resident.getByText("12:00 – 2:00 PM")).toBeVisible();
  await context.close();
});

test("the menu goes out to Excel and comes back in", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs on desktop only (file handling is the same on phones).");
  await signIn(page, ADMIN_PHONE);
  await expect(page).toHaveURL(/\/staff$/);
  await page.goto("/staff/menu");
  await page.getByRole("button", { name: "TEST PG (development)" }).click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("dine-menu-test-pg-development.xlsx");
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await file.path())!);
  expect(book.worksheets.map((s) => s.name)).toEqual(["Menu A", "Menu B"]);
  const sheet = book.getWorksheet("Menu B")!;
  expect(sheet.getRow(1).values).toEqual([undefined, "Day", "Breakfast", "Lunch", "Snacks", "Dinner"]);
  expect(sheet.getCell("A8").value).toBe("Sunday");

  // Fill Sunday's dinner in Menu B and upload: the editor fills in, unsaved.
  const dish = `Excel biryani ${Date.now() % 100000}`;
  sheet.getCell("E8").value = dish;
  const edited = testInfo.outputPath("menu.xlsx");
  await book.xlsx.writeFile(edited);
  await page.getByLabel("Upload a menu Excel file").setInputFiles(edited);
  await expect(page.getByText("Menus filled in from the file.", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: /^Menu B/ }).click();
  await expect(page.getByLabel("Menu B, Sunday, Dinner")).toHaveValue(dish);
  await expect(page.getByText(/Unsaved changes in Menu B/)).toBeVisible();

  // A file that isn't a menu is explained, not half-loaded.
  const wrong = testInfo.outputPath("not-a-menu.xlsx");
  const other = new ExcelJS.Workbook();
  other.addWorksheet("Menu A").addRow(["Hello", "World"]);
  other.addWorksheet("Menu B");
  await other.xlsx.writeFile(wrong);
  await page.getByLabel("Upload a menu Excel file").setInputFiles(wrong);
  await expect(page.getByText(/has no meal names in its first row/)).toBeVisible();
});
