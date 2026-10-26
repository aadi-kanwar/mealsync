import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { menuLabelFor, mondayOf } from "../lib/menus";
import { createActiveResident, createProperty, createStaff, errorCode, setupTest } from "./harness.test-utils";

// Sat 24 Oct 2026, 18:00 IST. This week runs Mon 19 Oct - Sun 25 Oct.
const NOW = Date.UTC(2026, 9, 24, 12, 30);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = await setupTest();
  await createProperty(t);
  await t.mutation(internal.meals.generateUpcoming, {});
  const admin = await createStaff(t, "admin");
  return { t, admin };
}

describe("week arithmetic", () => {
  test("weeks run Monday to Sunday", () => {
    expect(mondayOf("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(mondayOf("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });

  test("menus alternate every week, in both directions", () => {
    const start = "2026-10-19";
    expect(menuLabelFor("2026-10-21", start)).toBe("A");
    expect(menuLabelFor("2026-10-25", start)).toBe("A");
    expect(menuLabelFor("2026-10-26", start)).toBe("B");
    expect(menuLabelFor("2026-11-02", start)).toBe("A");
    expect(menuLabelFor("2026-10-12", start)).toBe("B");
    expect(menuLabelFor("2027-01-04", start)).toBe("B"); // across the year end (11 weeks later)
  });
});

describe("menus", () => {
  test("Admin enters both menus and picks this week's; residents see the right dishes each day", async () => {
    const { t, admin } = await setup();
    await admin.as.mutation(api.menus.save, {
      label: "A",
      entries: [
        { weekday: 0, mealType: "breakfast", items: "  Aloo   paratha, curd " },
        { weekday: 1, mealType: "lunch", items: "Rajma, rice" },
        { weekday: 1, mealType: "dinner", items: "" },
      ],
    });
    await admin.as.mutation(api.menus.save, {
      label: "B",
      entries: [{ weekday: 1, mealType: "lunch", items: "Chole, rice" }],
    });
    await admin.as.mutation(api.menus.setThisWeek, { label: "A" });

    const view = await admin.as.query(api.menus.get, {});
    expect(view).toMatchObject({ thisWeekStart: "2026-10-19", thisWeek: "A", nextWeek: "B" });
    expect(view.menus[0].entries).toEqual([
      { weekday: 0, mealType: "breakfast", items: "Aloo paratha, curd" },
      { weekday: 1, mealType: "lunch", items: "Rajma, rice" },
    ]);

    const resident = await createActiveResident(t);
    // Sun 25 Oct is still a Menu A week; Mon 26 Oct starts a Menu B week.
    const days = (await resident.as.query(api.meals.myDays, { startDate: "2026-10-25", days: 2 })).days;
    expect(days[0].meals.map((m) => m.menu)).toEqual(["Aloo paratha, curd", null, null, null]);
    expect(days[1].meals.map((m) => m.menu)).toEqual([null, "Chole, rice", null, null]);
    expect(days[0].meals[0]).toMatchObject({ serviceTime: "07:30", endTime: "09:30" });

    // Switching this week to B flips the whole rotation.
    await admin.as.mutation(api.menus.setThisWeek, { label: "B" });
    const after = (await resident.as.query(api.meals.myDays, { startDate: "2026-10-26", days: 1 })).days;
    expect(after[0].meals[1].menu).toBe("Rajma, rice");

    const audit = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(audit.filter((a) => a.startsWith("menu."))).toEqual([
      "menu.updated",
      "menu.updated",
      "menu.rotation_set",
      "menu.rotation_set",
    ]);
  });

  test("no menu is shown until a rotation is chosen", async () => {
    const { t, admin } = await setup();
    await admin.as.mutation(api.menus.save, { label: "A", entries: [{ weekday: 0, mealType: "lunch", items: "Dal" }] });
    const resident = await createActiveResident(t);
    const days = (await resident.as.query(api.meals.myDays, { startDate: "2026-10-25", days: 1 })).days;
    expect(days[0].meals.every((m) => m.menu === null)).toBe(true);
    expect((await admin.as.query(api.menus.get, {})).thisWeek).toBeNull();
  });

  test("checks the input", async () => {
    const { admin } = await setup();
    const save = (entries: { weekday: number; mealType: "lunch"; items: string }[]) =>
      errorCode(admin.as.mutation(api.menus.save, { label: "A", entries }));
    expect(await save([{ weekday: 7, mealType: "lunch", items: "x" }])).toBe("INVALID_INPUT");
    expect(await save([{ weekday: 1, mealType: "lunch", items: "x".repeat(201) }])).toBe("INVALID_INPUT");
    expect(
      await save([
        { weekday: 1, mealType: "lunch", items: "a" },
        { weekday: 1, mealType: "lunch", items: "b" },
      ]),
    ).toBe("INVALID_INPUT");
  });

  test("only the Admin can change menus", async () => {
    const { t } = await setup();
    const warden = await createStaff(t, "warden");
    const resident = await createActiveResident(t);
    for (const as of [warden.as, resident.as]) {
      expect(await errorCode(as.mutation(api.menus.save, { label: "A", entries: [] }))).toBe("FORBIDDEN");
      expect(await errorCode(as.mutation(api.menus.setThisWeek, { label: "A" }))).toBe("FORBIDDEN");
      expect(await errorCode(as.query(api.menus.get, {}))).toBe("FORBIDDEN");
    }
  });
});
