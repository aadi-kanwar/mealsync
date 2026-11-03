import { expect, test, type Page } from "./fixtures";

/**
 * Notifications: the Admin writes the text, and a pushed message really
 * shows up as a notification on the device. The text test needs a seeded
 * dev deployment; the delivery test needs none.
 */
const seedPassword = process.env.E2E_SEED_PASSWORD;
const ADMIN_PHONE = "9000000001";

test.skip(({ isMobile }) => isMobile, "Runs on desktop Chromium (uses its developer tools to deliver a push).");
// The full Chromium: Playwright's default headless build blocks notifications outright.
test.use({ channel: "chromium" });

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByLabel("Mobile number").fill(ADMIN_PHONE);
  await page.getByLabel("Password", { exact: true }).fill(seedPassword!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

test("a pushed reminder shows as a notification, with its title and message", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["notifications"], { origin: baseURL });
  await page.goto("/signin");
  // Dine's service worker is what shows notifications on phones.
  await page.evaluate(() => navigator.serviceWorker.register("/sw.js"));
  await page.evaluate(() => navigator.serviceWorker.ready);

  const cdp = await context.newCDPSession(page);
  const registration = new Promise<string>((resolve) =>
    cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
      const found = registrations.find((r: { scopeURL: string; isDeleted: boolean }) => !r.isDeleted);
      if (found) resolve(found.registrationId);
    }),
  );
  await cdp.send("ServiceWorker.enable");
  // Exactly what the server sends (see convex/push.ts), as the push service delivers it.
  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin: new URL(baseURL!).origin,
    registrationId: await registration,
    data: JSON.stringify({ title: "Sunrise PG", body: "Meals for tomorrow close at 6:00 AM.", url: "/home" }),
  });
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => [
          n.title,
          n.body,
          new URL(n.icon).pathname,
          new URL(n.badge).pathname,
        ]),
      ),
    )
    .toEqual([["Sunrise PG", "Meals for tomorrow close at 6:00 AM.", "/icon-192.png", "/notification-badge.png"]]);
  // Both pictures are really there to fetch.
  for (const path of ["/icon-192.png", "/notification-badge.png"]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
});

test("the Admin writes the notification text and sees a preview", async ({ page }) => {
  test.skip(!seedPassword, "Set E2E_SEED_PASSWORD (the DEV_SEED_PASSWORD of a seeded dev deployment).");
  await signIn(page);
  await page.goto("/staff/settings?section=reminders");
  await page.getByLabel("Property", { exact: true }).selectOption({ label: "TEST PG (development)" });
  const preview = page.getByLabel("Notification preview");
  await expect(preview).toContainText("Dine: choose your meals");

  await page.getByLabel("Title").fill("Sunrise PG");
  await page.getByLabel("Message").fill("Meals for ");
  await page.getByRole("group", { name: "Fill-ins" }).getByRole("button", { name: "{day}" }).click();
  await expect(page.getByLabel("Message")).toHaveValue("Meals for {day}");
  await expect(preview).toContainText("Sunrise PG");
  await expect(preview).toContainText("Meals for tomorrow");

  // Saved, then put back to the standard text (shared dev data).
  await page.getByRole("button", { name: "Save reminders" }).click();
  await expect(page.getByText("with this text", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Sunrise PG");
  await page.getByRole("button", { name: "Use the standard text" }).click();
  await page.getByRole("button", { name: "Save reminders" }).click();
  await expect(page.getByText("with this text", { exact: false }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Dine: choose your meals");
  await expect(page.getByRole("heading", { name: "Try it on this phone" })).toBeVisible();
});
