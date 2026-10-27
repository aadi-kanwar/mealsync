import { expect, test } from "@playwright/test";

// These checks need no database: they cover page protection and the
// sign-in form's own validation.

test("signed-out visitors are sent to the sign-in page", async ({ page }) => {
  for (const path of ["/staff", "/staff/settings", "/staff/signups", "/staff/team", "/home", "/upcoming", "/profile", "/staff/menu", "/change-password", "/staff/residents", "/staff/responses", "/pending", "/onboarding"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/signin$/);
  }
});

test("the landing page offers two ways in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /cooked for you/ })).toBeVisible();
  await page.getByRole("link", { name: "PG admin? Sign in here" }).click();
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Create account" })).toHaveCount(0);
  await page.getByRole("link", { name: "Dine home" }).click();
  await page.getByRole("link", { name: "Sign in or create account" }).click();
  await expect(page.getByRole("tab", { name: "Create account" })).toBeVisible();
});

test("sign-in form explains mistakes in plain language", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByLabel("Country")).toHaveValue("IN");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter your mobile number.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();

  await page.getByLabel("Mobile number").fill("12345");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter a valid mobile number.")).toBeVisible();
});

test("create-account form checks password rules before sending anything", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await expect(page.getByText("Enter your room number.")).toBeVisible();
  await page.getByLabel("Mobile number").fill("98765 43210");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Type the password again").fill("different");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
  await expect(page.getByText("The two passwords don't match.")).toBeVisible();

  await page.getByLabel("Password", { exact: true }).fill("x9876543210x");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Don't use your phone number as your password.")).toBeVisible();
});

test("password can be shown and hidden", async ({ page }) => {
  await page.goto("/signin");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("secret-pass");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
});

test("no sideways scrolling on the sign-in page", async ({ page }) => {
  await page.goto("/signin");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
