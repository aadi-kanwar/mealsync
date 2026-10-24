import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests in a real browser.
 *
 * - e2e/no-backend.spec.ts runs anywhere (no database needed).
 * - e2e/signup-approval.spec.ts needs a development Convex deployment that has
 *   been seeded (`npx convex run seed:dev`). Set E2E_SEED_PASSWORD to the
 *   DEV_SEED_PASSWORD used for the seed; otherwise those tests are skipped.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  // A production build, not `next dev`: the dev server compiles each page on
  // its first visit, which can take longer than a test's timeouts.
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/signin`,
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
