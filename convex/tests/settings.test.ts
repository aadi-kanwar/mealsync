import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { DEFAULT_QUESTIONS, DEFAULT_WASTE_MESSAGE, questionFor } from "../lib/messages";
import { createActiveResident, createProperty, createStaff, errorCode, setupTest } from "./harness.test-utils";

test("the Admin renames the organisation and PG; audited; others can't", async () => {
  const t = await setupTest();
  await createProperty(t);
  const admin = await createStaff(t, "admin");
  expect(await admin.as.query(api.settings.get, {})).toMatchObject({ organizationName: "Test Org", propertyName: "Test PG" });
  await admin.as.mutation(api.settings.update, { organizationName: " Sunrise  Stays ", propertyName: "Sunrise PG, Koramangala" });
  expect(await admin.as.query(api.settings.get, {})).toMatchObject({
    organizationName: "Sunrise Stays",
    propertyName: "Sunrise PG, Koramangala",
  });
  expect((await admin.as.query(api.users.me, {}))?.property?.name).toBe("Sunrise PG, Koramangala");
  expect(await errorCode(admin.as.mutation(api.settings.update, { organizationName: "A", propertyName: "Fine name" }))).toBe(
    "INVALID_INPUT",
  );
  const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
  expect(audit.at(-1)).toMatchObject({ action: "settings.updated" });

  const warden = await createStaff(t, "warden");
  const resident = await createActiveResident(t);
  for (const as of [warden.as, resident.as]) {
    expect(await errorCode(as.query(api.settings.get, {}))).toBe("FORBIDDEN");
    expect(await errorCode(as.mutation(api.settings.update, { organizationName: "Xx", propertyName: "Yy" }))).toBe("FORBIDDEN");
  }
});

test("question of the day and waste message: defaults, Admin edits, one question per day in turn", async () => {
  const t = await setupTest();
  await createProperty(t);
  await t.mutation(internal.meals.generateUpcoming, {});
  const admin = await createStaff(t, "admin");
  const resident = await createActiveResident(t);

  const defaults = await admin.as.query(api.settings.get, {});
  expect(defaults.questions).toEqual(DEFAULT_QUESTIONS);
  expect(defaults.wasteMessage).toBe(DEFAULT_WASTE_MESSAGE);

  const questions = ["Hungry?", "What will you be having today?", "Eating with us today?"];
  await admin.as.mutation(api.settings.updateResidentMessages, {
    questions: questions.map((q) => `  ${q} `),
    wasteMessage: "  Food cooked today can't be served tomorrow. Please answer.  ",
  });
  const view = await resident.as.query(api.meals.myDays, { startDate: "2026-11-01", days: 6 });
  expect(view.property.wasteMessage).toBe("Food cooked today can't be served tomorrow. Please answer.");
  const asked = view.days.map((d) => d.question);
  // Each day gets the next question; after the third it starts again.
  expect(new Set(asked)).toEqual(new Set(questions));
  expect(asked.slice(3)).toEqual(asked.slice(0, 3));
  expect(questionFor("2026-11-01", questions)).not.toBe(questionFor("2026-11-02", questions));

  const save = (qs: string[], wasteMessage = "A long enough message.") =>
    errorCode(admin.as.mutation(api.settings.updateResidentMessages, { questions: qs, wasteMessage }));
  expect(await save(["Only one?"])).toBe("INVALID_INPUT");
  expect(await save(["ok?", "", "fine?"])).toBe("INVALID_INPUT");
  expect(await save(["ok?", "x".repeat(121), "fine?"])).toBe("INVALID_INPUT");
  expect(await save(questions, "short")).toBe("INVALID_INPUT");

  const warden = await createStaff(t, "warden");
  expect(await errorCode(warden.as.mutation(api.settings.updateResidentMessages, { questions, wasteMessage: "Long enough text" }))).toBe(
    "FORBIDDEN",
  );
});
