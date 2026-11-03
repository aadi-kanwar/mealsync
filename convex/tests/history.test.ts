import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createActiveResident, createProperty, setupTest, type T } from "./harness.test-utils";

// Sat 24 Oct 2026, 18:00 IST.
const NOW = Date.UTC(2026, 9, 24, 12, 30);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function services(t: T, date: string) {
  return await t.run(async (ctx) =>
    Object.fromEntries(
      (await ctx.db.query("mealServices").collect()).filter((s) => s.serviceDate === date).map((s) => [s.mealType, s._id]),
    ),
  );
}

test("every save that changes something is in the resident's history, with what changed; unchanged saves aren't", async () => {
  const t = await setupTest();
  await createProperty(t);
  await t.mutation(internal.meals.generateUpcoming, {});
  const resident = await createActiveResident(t);
  const other = await createActiveResident(t, "Bina Das", "202");
  const sun = await services(t, "2026-10-25");
  const mon = await services(t, "2026-10-26");
  const save = (choices: { mealServiceId: string; selection: "yes" | "no" }[]) =>
    resident.as.mutation(api.meals.saveChoices, { choices: choices as never });

  await save([
    { mealServiceId: sun.lunch, selection: "yes" },
    { mealServiceId: sun.dinner, selection: "no" },
  ]);
  vi.setSystemTime(NOW + 60_000);
  // Save pressed again without changing anything: nothing new.
  await save([
    { mealServiceId: sun.lunch, selection: "yes" },
    { mealServiceId: sun.dinner, selection: "no" },
  ]);
  vi.setSystemTime(NOW + 120_000);
  // One save covering two days: one history entry per day.
  await save([
    { mealServiceId: sun.dinner, selection: "yes" },
    { mealServiceId: mon.breakfast, selection: "no" },
  ]);
  await other.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: sun.lunch as never, selection: "no" }] });

  const { saves, before } = await resident.as.query(api.meals.myChanges, {});
  expect(before).toBeNull();
  // Newest first (the test clock can tick by a millisecond inside a save).
  expect(saves.map((x) => Math.round((x.savedAt - NOW) / 1000))).toEqual([120, 120, 0]);
  expect(saves.map(({ savedAt, ...rest }) => (void savedAt, rest))).toEqual([
    { date: "2026-10-25", byStaff: null, changes: [{ mealType: "dinner", meal: "Dinner", from: "no", to: "yes" }] },
    { date: "2026-10-26", byStaff: null, changes: [{ mealType: "breakfast", meal: "Breakfast", from: "none", to: "no" }] },
    {
      date: "2026-10-25",
      byStaff: null,
      changes: [
        { mealType: "lunch", meal: "Lunch", from: "none", to: "yes" },
        { mealType: "dinner", meal: "Dinner", from: "none", to: "no" },
      ],
    },
  ]);
});

test("a long history comes in pages, and no save is split between pages", async () => {
  const t = await setupTest();
  await createProperty(t);
  await t.mutation(internal.meals.generateUpcoming, {});
  const resident = await createActiveResident(t);
  const sun = await services(t, "2026-10-25");
  // 50 saves, each changing two meals: 100 changes.
  for (let i = 0; i < 50; i += 1) {
    vi.setSystemTime(NOW + i * 1000);
    const selection = i % 2 === 0 ? "yes" : "no";
    await resident.as.mutation(api.meals.saveChoices, {
      choices: [
        { mealServiceId: sun.lunch as never, selection },
        { mealServiceId: sun.dinner as never, selection },
      ],
    });
  }
  const first = await resident.as.query(api.meals.myChanges, {});
  expect(first.before).not.toBeNull();
  const second = await resident.as.query(api.meals.myChanges, { before: first.before! });
  expect(second.before).toBeNull();
  const all = [...first.saves, ...second.saves];
  expect(all).toHaveLength(50);
  expect(all.every((s) => s.changes.length === 2)).toBe(true);
  expect(new Set(all.map((s) => s.savedAt)).size).toBe(50);
});
