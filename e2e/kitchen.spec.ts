import { expect, test, type Page } from "@playwright/test";

/**
 * Master prompt E2E 8: the Kitchen finalizes a report and records actuals,
 * plus the Admin's reopen, version history and the CSV export. Uses today's
 * Snacks, whose cutoff (yesterday 9 PM) has always passed. Needs a seeded
 * development Convex deployment.
 */
const seedPassword = process.env.E2E_SEED_PASSWORD;
const ADMIN_PHONE = "9000000001";
const KITCHEN_PHONE = "9000000003";

test.skip(!seedPassword, "Set E2E_SEED_PASSWORD (the DEV_SEED_PASSWORD of a seeded dev deployment).");

async function signIn(page: Page, phone: string) {
  await page.goto("/signin");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(seedPassword!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

test("kitchen finalizes today's snacks, records actuals and exports the report", async ({ browser }) => {
  // Earlier runs may have finalized it already: the Admin reopens it first.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, ADMIN_PHONE);
  await admin.goto("/staff/kitchen");
  const adminSnacks = admin.getByRole("region", { name: /^Snacks/ });
  await expect(adminSnacks.getByText("Eligible (N)")).toBeVisible();
  if (await adminSnacks.getByRole("button", { name: "Reopen" }).isVisible()) {
    await adminSnacks.getByRole("button", { name: "Reopen" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Reopen" }).click();
    await expect(adminSnacks.getByText(/^Reopened \(v\d+\)$/)).toBeVisible();
  }
  await adminContext.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, KITCHEN_PHONE);
  await page.getByRole("link", { name: "Kitchen report" }).first().click();
  const snacks = page.getByRole("region", { name: /^Snacks/ });

  // Finalize with a fixed buffer of 2: the target is Yes + 2.
  const yes = Number(await snacks.getByText("Yes (Y)").locator("xpath=following-sibling::*[1]").textContent());
  await snacks.getByLabel("How many").fill("2");
  await expect(snacks.getByText(`= Yes ${yes} + buffer 2`)).toBeVisible();
  await snacks.getByRole("button", { name: "Finalize target" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Finalize Snacks: cook for ${yes + 2}?` })).toBeVisible();
  await dialog.getByRole("button", { name: "Finalize", exact: true }).click();
  await expect(snacks.getByText(/^Finalized \(v\d+\)$/)).toBeVisible();
  await expect(snacks.getByText(`Yes ${yes} + buffer 2 (fixed +2)`)).toBeVisible();
  // The Kitchen can't reopen; only an Admin can.
  await expect(snacks.getByRole("button", { name: "Reopen" })).toHaveCount(0);

  await snacks.getByText(/^Version history/).click();
  await expect(snacks.getByRole("table").getByText("Finalized").first()).toBeVisible();

  // Record actuals; impossible numbers are explained first.
  await snacks.getByRole("button", { name: /^(Record|Edit) actuals$/ }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Prepared").fill("10");
  await form.getByLabel("Served").fill("12");
  await form.getByLabel("Kept as leftover").fill("0");
  await form.getByLabel("Thrown away", { exact: true }).fill("0");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByText("Served can't be more than prepared.")).toBeVisible();
  await form.getByLabel("Served").fill("8");
  await form.getByLabel("Kept as leftover").fill("1");
  await form.getByLabel("Thrown away", { exact: true }).fill("1");
  await form.getByLabel("Thrown away, weight in grams").fill("250");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toHaveCount(0);
  await expect(snacks.getByText("250 g")).toBeVisible();
  await expect(snacks.getByText("Not served", { exact: true }).locator("xpath=following-sibling::*[1]")).toHaveText("2");

  // CSV export.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^mealsync-kitchen-\d{4}-\d{2}-\d{2}\.csv$/);

  await context.close();
});
