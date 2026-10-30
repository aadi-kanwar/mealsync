import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { DEFAULT_QUESTIONS, DEFAULT_WASTE_MESSAGE, questionFor } from "../lib/messages";
import { createActiveResident, createProperty, createStaff, errorCode, setupTest } from "./harness.test-utils";

test("the Admin renames the organisation and a PG, and adds PGs; audited; others can't", async () => {
  const t = await setupTest();
  const first = await createProperty(t);
  const admin = await createStaff(t, "admin");
  expect(await admin.as.query(api.settings.get, {})).toMatchObject({ organizationName: "Test Org", propertyName: "Test PG" });
  await admin.as.mutation(api.settings.renameOrganization, { name: " Sunrise  Stays " });
  await admin.as.mutation(api.settings.renameProperty, { name: "Sunrise PG, Koramangala" });
  expect(await admin.as.query(api.settings.get, {})).toMatchObject({
    organizationName: "Sunrise Stays",
    propertyName: "Sunrise PG, Koramangala",
  });
  expect((await admin.as.query(api.users.me, {}))?.staff?.organizationName).toBe("Sunrise Stays");
  expect(await errorCode(admin.as.mutation(api.settings.renameOrganization, { name: "A" }))).toBe("INVALID_INPUT");
  const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
  expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["organization.renamed", "settings.updated"]));

  // A second PG: comes with the default meals; settings then need a chosen PG.
  const second = await admin.as.mutation(api.settings.addProperty, { name: "Sunrise PG, HSR" });
  const org = await admin.as.query(api.settings.organization, {});
  expect(org.properties.map((p) => p.name)).toEqual(["Sunrise PG, HSR", "Sunrise PG, Koramangala"]);
  expect(await errorCode(admin.as.query(api.settings.get, {}))).toBe("CHOOSE_PROPERTY");
  expect((await admin.as.query(api.settings.get, { propertyId: second })).meals).toHaveLength(4);
  expect(await errorCode(admin.as.mutation(api.settings.addProperty, { name: "sunrise pg, hsr" }))).toBe("CONFLICT");
  expect(
    await errorCode(admin.as.mutation(api.settings.renameProperty, { propertyId: first._id, name: "Sunrise PG, HSR" })),
  ).toBe("CONFLICT");

  const warden = await createStaff(t, "warden");
  const resident = await createActiveResident(t);
  for (const as of [warden.as, resident.as]) {
    expect(await errorCode(as.query(api.settings.get, {}))).toBe("FORBIDDEN");
    expect(await errorCode(as.mutation(api.settings.renameProperty, { name: "Yy pg" }))).toBe("FORBIDDEN");
    expect(await errorCode(as.mutation(api.settings.addProperty, { name: "Yy pg" }))).toBe("FORBIDDEN");
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

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

test("the Admin changes meal times and the deadline; only meals still open take them", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 27, 15, 32)); // Tue 27 Oct, 21:02 IST
  try {
    const t = await setupTest();
    await createProperty(t);
    await t.mutation(internal.meals.generateUpcoming, {});
    const admin = await createStaff(t, "admin");
    const mealOn = (date: string, mealType: string) =>
      t.run(async (ctx) =>
        (await ctx.db.query("mealServices").collect()).find((s) => s.serviceDate === date && s.mealType === mealType) ?? null,
      );
    const todayBefore = await mealOn("2026-10-27", "lunch");

    const view = await admin.as.query(api.settings.get, {});
    expect(view.cutoff).toEqual({ daysBefore: 0, time: "06:00" });
    expect(view.warnMinutes).toBe(120);
    expect(view.meals.map((m) => [m.mealType, m.displayName, m.serviceTime, m.endTime, m.active, m.serviceDays])).toEqual([
      ["breakfast", "Breakfast", "07:30", "09:30", true, ALL_DAYS],
      ["lunch", "Lunch", "12:00", "14:00", true, ALL_DAYS],
      ["snacks", "Snacks", "17:00", "18:00", true, ALL_DAYS],
      ["dinner", "Dinner", "20:00", "21:30", true, ALL_DAYS],
    ]);
    const meals = view.meals.map(({ mealType, displayName, serviceTime, endTime, serviceDays, active }) => ({
      mealType,
      displayName,
      serviceTime,
      endTime,
      serviceDays,
      active,
    }));
    const save = (changes: Partial<(typeof meals)[number]>[] = [], cutoff = { daysBefore: 0, time: "06:00" }, warnMinutes = 120) =>
      admin.as.mutation(api.settings.updateMeals, {
        meals: meals.map((m) => ({ ...m, ...changes.find((c) => c.mealType === m.mealType) })),
        cutoff,
        warnMinutes,
      });

    const result = await save(
      [{ mealType: "lunch", displayName: "Lunch thali", serviceTime: "12:30", endTime: "14:30" }],
      { daysBefore: 1, time: "22:00" },
      60,
    );
    expect(result.openMealsUpdated).toBeGreaterThan(0);
    const tomorrow = (await mealOn("2026-10-28", "lunch"))!;
    expect(tomorrow).toMatchObject({ serviceTime: "12:30", endTime: "14:30", cutoffAt: Date.UTC(2026, 9, 27, 16, 30) });
    expect(tomorrow.policySnapshot.displayName).toBe("Lunch thali");
    // Today's meals had already closed: unchanged.
    expect(await mealOn("2026-10-27", "lunch")).toEqual(todayBefore);
    const after = await admin.as.query(api.settings.get, {});
    expect(after.cutoff).toEqual({ daysBefore: 1, time: "22:00" });
    expect(after.warnMinutes).toBe(60);
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.at(-1)).toMatchObject({ action: "settings.meal_times_updated" });

    // A deadline that has already passed for tomorrow leaves tomorrow as it is.
    await save([], { daysBefore: 1, time: "21:00" });
    expect((await mealOn("2026-10-28", "lunch"))!.cutoffAt).toBe(tomorrow.cutoffAt);
    expect((await mealOn("2026-10-29", "lunch"))!.cutoffAt).toBe(Date.UTC(2026, 9, 28, 15, 30));

    // Snacks only on weekdays; Sunday 1 Nov loses them (nobody answered), Monday keeps them.
    await save([{ mealType: "snacks", serviceDays: [1, 2, 3, 4, 5] }]);
    expect(await mealOn("2026-11-01", "snacks")).toBeNull();
    expect(await mealOn("2026-11-02", "snacks")).not.toBeNull();
    // Snacks off entirely, but someone already said Yes for Thursday: kept, marked not served.
    const resident = await createActiveResident(t);
    const thursday = (await mealOn("2026-10-29", "snacks"))!;
    await resident.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: thursday._id, selection: "yes" }] });
    await save([{ mealType: "snacks", active: false }]);
    expect((await mealOn("2026-10-29", "snacks"))!.status).toBe("cancelled");
    expect(await mealOn("2026-10-30", "snacks")).toBeNull();
    // Back on every day: served again, and the missing days come back.
    await save([{ mealType: "snacks", active: true, serviceDays: ALL_DAYS }]);
    expect((await mealOn("2026-10-29", "snacks"))!.status).toBe("scheduled");
    expect(await mealOn("2026-11-01", "snacks")).not.toBeNull();

    const fails = async (changes: Partial<(typeof meals)[number]>[], cutoff = { daysBefore: 0, time: "06:00" }, warn = 120) =>
      errorCode(save(changes, cutoff, warn));
    expect(await fails([], { daysBefore: 2, time: "06:00" })).toBe("INVALID_INPUT");
    expect(await fails([], undefined, 45)).toBe("INVALID_INPUT");
    expect(await fails([{ mealType: "lunch", serviceTime: "14:00", endTime: "13:00" }])).toBe("INVALID_INPUT");
    expect(await fails([{ mealType: "lunch", serviceTime: "1 PM" }])).toBe("INVALID_INPUT");
    expect(await fails([{ mealType: "lunch", displayName: "L" }])).toBe("INVALID_INPUT");
    expect(await fails([{ mealType: "lunch", serviceDays: [] }])).toBe("INVALID_INPUT");
    expect(await fails([{ mealType: "lunch", serviceDays: [7] }])).toBe("INVALID_INPUT");
    expect(await fails(meals.map((m) => ({ mealType: m.mealType, active: false })))).toBe("INVALID_INPUT");
    // A deadline after a meal starts is allowed: it's only what residents must keep to.
    expect(await fails([{ mealType: "breakfast", serviceTime: "05:30", endTime: "07:00" }])).toBe("NO_ERROR");
    expect(await fails([], { daysBefore: 0, time: "08:00" })).toBe("NO_ERROR");

    const warden = await createStaff(t, "warden");
    expect(
      await errorCode(warden.as.mutation(api.settings.updateMeals, { meals: [], cutoff: { daysBefore: 0, time: "06:00" }, warnMinutes: 120 })),
    ).toBe("FORBIDDEN");
  } finally {
    vi.useRealTimers();
  }
});
