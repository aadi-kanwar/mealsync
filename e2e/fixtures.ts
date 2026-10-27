import { test as base, type Browser, type BrowserContext } from "@playwright/test";

export { expect, type Page } from "@playwright/test";

/** Hides the "Add to home screen" and "Turn on reminders" pop-ups, which would cover the page. */
function skipPrompts() {
  try {
    localStorage.setItem("dine-installed", "1");
    sessionStorage.setItem("dine-reminders-later", "1");
  } catch {
    // about:blank has no storage.
  }
}

export async function withoutPrompts(context: BrowserContext) {
  await context.addInitScript(skipPrompts);
  return context;
}

/** A fresh browser context (another person) without the pop-ups. */
export async function newContext(browser: Browser) {
  return withoutPrompts(await browser.newContext());
}

/** `test` whose page starts without the pop-ups. Tests of the pop-ups use @playwright/test directly. */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await provide(await withoutPrompts(context));
  },
});
