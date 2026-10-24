import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { horizonDates, ineligibilityOn } from "../lib/meals";
import { addDays, computeCutoffAt, weekdayOf } from "../lib/time";
import {
  createActiveResident,
  createProperty,
  createSignedUp,
  createStaff,
  errorCode,
  setupTest,
  type T,
} from "./harness.test-utils";

// Sat 24 Oct 2026, 18:00 IST (12:30 UTC). Tomorrow's cutoff is today 21:00 IST.
const NOW = Date.UTC(2026, 9, 24, 12, 30);
const TODAY = "2026-10-24";
const TOMORROW = "2026-10-25";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = await setupTest();
  const property = await createProperty(t);
  await t.mutation(internal.meals.generateUpcoming, {});
  return { t, property };
}

async function service(t: T, date: string, mealType: Doc<"mealServices">["mealType"]) {
  return await t.run(async (ctx) => {
    const all = await ctx.db.query("mealServices").collect();
    return all.find((s) => s.serviceDate === date && s.mealType === mealType)!;
  });
}

const logs = (t: T) => t.run((ctx) => ctx.db.query("mealActivityLog").collect());
const responses = (t: T) => t.run((ctx) => ctx.db.query("mealResponses").collect());

describe("cutoff calculation", () => {
  test("'1 day before, 21:00' in India closes the evening before", () => {
    // Tue 3 Nov 2026 breakfast -> Mon 2 Nov 21:00 IST = 15:30 UTC.
    expect(computeCutoffAt("2026-11-03", { daysBefore: 1, time: "21:00" }, "Asia/Kolkata")).toBe(
      Date.UTC(2026, 10, 2, 15, 30),
    );
  });

  test("works across midnight, month ends and year ends", () => {
    // 00:30 IST on 1 Jan is still 31 Dec in UTC.
    expect(computeCutoffAt("2027-01-01", { daysBefore: 0, time: "00:30" }, "Asia/Kolkata")).toBe(
      Date.UTC(2026, 11, 31, 19, 0),
    );
    expect(computeCutoffAt("2026-03-01", { daysBefore: 1, time: "23:59" }, "Asia/Kolkata")).toBe(
      Date.UTC(2026, 1, 28, 18, 29),
    );
  });

  test("follows the property's own timezone, including daylight saving", () => {
    // New York: 21:00 EDT (UTC-4) in summer, 21:00 EST (UTC-5) in winter.
    expect(computeCutoffAt("2026-07-02", { daysBefore: 1, time: "21:00" }, "America/New_York")).toBe(
      Date.UTC(2026, 6, 2, 1, 0),
    );
    expect(computeCutoffAt("2026-12-02", { daysBefore: 1, time: "21:00" }, "America/New_York")).toBe(
      Date.UTC(2026, 11, 2, 2, 0),
    );
  });

  test("calendar helpers", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-10-25")).toBe(0); // Sunday
  });

  test("'today' is the property's date, not UTC's", () => {
    // 20:00 UTC on 24 Oct is already 25 Oct in India.
    expect(horizonDates(Date.UTC(2026, 9, 24, 20, 0), "Asia/Kolkata")[0]).toBe("2026-10-25");
  });
});

describe("meal service generation", () => {
  test("creates today + 7 days of the four default meals, with frozen settings", async () => {
    const { t } = await setup();
    const all = await t.run((ctx) => ctx.db.query("mealServices").collect());
    expect(all).toHaveLength(8 * 4);
    expect(new Set(all.map((s) => s.serviceDate)).size).toBe(8);
    const breakfast = await service(t, TOMORROW, "breakfast");
    expect(breakfast).toMatchObject({
      serviceTime: "08:00",
      status: "scheduled",
      cutoffAt: Date.UTC(2026, 9, 24, 15, 30), // 24 Oct 21:00 IST
      policySnapshot: {
        displayName: "Breakfast",
        cutoffRule: { daysBefore: 1, time: "21:00" },
        timezone: "Asia/Kolkata",
      },
    });
  });

  test("is safe to rerun: no duplicates", async () => {
    const { t } = await setup();
    expect(await t.mutation(internal.meals.generateUpcoming, {})).toBe(0);
    const resident = await createActiveResident(t);
    expect(await resident.as.mutation(api.meals.ensureUpcoming, {})).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("mealServices").collect()).length)).toBe(32);
  });

  test("next day's run adds only the new day", async () => {
    const { t } = await setup();
    vi.setSystemTime(NOW + 24 * 3600_000);
    expect(await t.mutation(internal.meals.generateUpcoming, {})).toBe(4);
  });

  test("skips inactive slots, days the slot doesn't run, and dates outside its range", async () => {
    const t = await setupTest();
    await createProperty(t);
    await t.run(async (ctx) => {
      const slots = await ctx.db.query("mealSlots").collect();
      const by = (m: string) => slots.find((s) => s.mealType === m)!;
      await ctx.db.patch(by("snacks")._id, { active: false });
      await ctx.db.patch(by("breakfast")._id, { serviceDays: [0] }); // Sundays only
      await ctx.db.patch(by("lunch")._id, { effectiveFrom: addDays(TODAY, 3) });
      await ctx.db.patch(by("dinner")._id, { effectiveUntil: TODAY });
    });
    await t.mutation(internal.meals.generateUpcoming, {});
    const all = await t.run((ctx) => ctx.db.query("mealServices").collect());
    const count = (m: string) => all.filter((s) => s.mealType === m).length;
    expect(count("snacks")).toBe(0);
    expect(count("breakfast")).toBe(1); // Sun 25 Oct
    expect(count("lunch")).toBe(5);
    expect(count("dinner")).toBe(1);
  });

  test("changing a slot's cutoff affects only services created afterwards", async () => {
    const { t } = await setup();
    const before = await service(t, TOMORROW, "breakfast");
    await t.run(async (ctx) => {
      const slot = (await ctx.db.query("mealSlots").collect()).find((s) => s.mealType === "breakfast")!;
      await ctx.db.patch(slot._id, { cutoffRule: { daysBefore: 0, time: "06:00" } });
    });
    vi.setSystemTime(NOW + 24 * 3600_000);
    await t.mutation(internal.meals.generateUpcoming, {});
    expect((await service(t, TOMORROW, "breakfast")).cutoffAt).toBe(before.cutoffAt);
    const added = await service(t, addDays(TODAY, 8), "breakfast");
    expect(added.policySnapshot.cutoffRule).toEqual({ daysBefore: 0, time: "06:00" });
    expect(added.cutoffAt).toBe(Date.UTC(2026, 10, 1, 0, 30)); // 1 Nov 06:00 IST
  });

  test("the scheduled job does nothing before the PG is set up", async () => {
    const t = await setupTest();
    expect(await t.mutation(internal.meals.generateUpcoming, {})).toBe(0);
  });

  test("pending residents and staff without a resident record can't trigger it", async () => {
    const { t } = await setup();
    const pending = await createSignedUp(t);
    expect(await errorCode(pending.as.mutation(api.meals.ensureUpcoming, {}))).toBe("RESIDENT_NOT_ACTIVE");
    const warden = await createStaff(t, "warden");
    expect(await errorCode(warden.as.mutation(api.meals.ensureUpcoming, {}))).toBe("FORBIDDEN");
  });
});

describe("eligibility", () => {
  const base = { status: "active", validFrom: "2026-11-01", validUntil: "2026-11-30" } as Doc<"residents">;

  test("validity dates are inclusive", () => {
    expect(ineligibilityOn(base, [], "2026-10-31")).toBe("before_start");
    expect(ineligibilityOn(base, [], "2026-11-01")).toBeNull();
    expect(ineligibilityOn(base, [], "2026-11-30")).toBeNull();
    expect(ineligibilityOn(base, [], "2026-12-01")).toBe("after_end");
  });

  test("approved leave covers its first and last day, and nothing outside", () => {
    const leave = [{ startDate: "2026-11-10", endDate: "2026-11-12" }];
    expect(ineligibilityOn(base, leave, "2026-11-09")).toBeNull();
    expect(ineligibilityOn(base, leave, "2026-11-10")).toBe("on_leave");
    expect(ineligibilityOn(base, leave, "2026-11-12")).toBe("on_leave");
    expect(ineligibilityOn(base, leave, "2026-11-13")).toBeNull();
  });

  test("pending, rejected and inactive residents are never eligible", () => {
    for (const status of ["pending", "rejected", "inactive"] as const) {
      expect(ineligibilityOn({ ...base, status }, [], "2026-11-15")).toBe("not_active");
    }
    expect(ineligibilityOn({ ...base, validFrom: undefined }, [], "2026-11-15")).toBe("before_start");
  });
});

describe("saving choices", () => {
  test("a pending resident can't save; staff without a resident record can't either", async () => {
    const { t } = await setup();
    const breakfast = await service(t, TOMORROW, "breakfast");
    const pending = await createSignedUp(t);
    const choices = [{ mealServiceId: breakfast._id, selection: "yes" as const }];
    expect(await errorCode(pending.as.mutation(api.meals.saveChoices, { choices }))).toBe("RESIDENT_NOT_ACTIVE");
    const warden = await createStaff(t, "warden");
    expect(await errorCode(warden.as.mutation(api.meals.saveChoices, { choices }))).toBe("FORBIDDEN");
    expect(await responses(t)).toHaveLength(0);
  });

  test("saves all four meals and logs each one", async () => {
    const { t } = await setup();
    const resident = await createActiveResident(t, "Asha Rao", "204");
    const meals = await Promise.all(
      (["breakfast", "lunch", "snacks", "dinner"] as const).map((m) => service(t, TOMORROW, m)),
    );
    const result = await resident.as.mutation(api.meals.saveChoices, {
      choices: meals.map((m, i) => ({ mealServiceId: m._id, selection: i % 2 ? ("no" as const) : ("yes" as const) })),
    });
    expect(result.changed).toBe(4);
    expect(result.savedAt - NOW).toBeLessThan(1000); // the server's clock
    expect(await responses(t)).toHaveLength(4);
    const entries = await logs(t);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      residentName: "Asha Rao",
      roomNumber: "204",
      serviceDate: TOMORROW,
      mealType: "breakfast",
      mealDisplayName: "Breakfast",
      previousSelection: "none",
      newSelection: "yes",
      afterCutoff: false,
      actorUserId: resident.userId,
      actorName: "Asha Rao",
      actorRole: "resident",
      source: "resident_app",
      responseVersion: 1,
      createdAt: result.savedAt,
    });
  });

  test("re-saving the same choice creates no duplicate and no log entry", async () => {
    const { t } = await setup();
    const resident = await createActiveResident(t);
    const lunch = await service(t, TOMORROW, "lunch");
    const choices = [{ mealServiceId: lunch._id, selection: "yes" as const }];
    const first = await resident.as.mutation(api.meals.saveChoices, { choices });
    vi.setSystemTime(NOW + 60_000);
    expect(await resident.as.mutation(api.meals.saveChoices, { choices })).toMatchObject({ changed: 0 });
    const saved = await responses(t);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ version: 1, updatedAt: first.savedAt });
    expect(await logs(t)).toHaveLength(1);
  });

  test("changing a choice updates the one response and logs previous -> new", async () => {
    const { t } = await setup();
    const resident = await createActiveResident(t);
    const dinner = await service(t, TOMORROW, "dinner");
    await resident.as.mutation(api.meals.saveChoices, {
      choices: [{ mealServiceId: dinner._id, selection: "yes" }],
    });
    vi.setSystemTime(NOW + 60_000);
    await resident.as.mutation(api.meals.saveChoices, {
      choices: [{ mealServiceId: dinner._id, selection: "no" }],
    });
    const saved = await responses(t);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ selection: "no", version: 2, updatedAt: NOW + 60_000 });
    const entries = await logs(t);
    expect(entries.map((e) => [e.previousSelection, e.newSelection, e.responseVersion])).toEqual([
      ["none", "yes", 1],
      ["yes", "no", 2],
    ]);
  });

  test("is refused after the cutoff, by the server's clock, and saves nothing else in the same request", async () => {
    const { t } = await setup();
    const resident = await createActiveResident(t);
    const tomorrow = await service(t, TOMORROW, "breakfast");
    const later = await service(t, addDays(TODAY, 2), "breakfast");
    const todayLunch = await service(t, TODAY, "lunch"); // closed yesterday 21:00
    expect(
      await errorCode(
        resident.as.mutation(api.meals.saveChoices, {
          choices: [
            { mealServiceId: later._id, selection: "yes" },
            { mealServiceId: todayLunch._id, selection: "yes" },
          ],
        }),
      ),
    ).toBe("CUTOFF_PASSED");
    expect(await responses(t)).toHaveLength(0);
    expect(await logs(t)).toHaveLength(0);

    // Exactly at the cutoff counts as too late.
    vi.setSystemTime(tomorrow.cutoffAt - 1);
    await resident.as.mutation(api.meals.saveChoices, {
      choices: [{ mealServiceId: tomorrow._id, selection: "yes" }],
    });
    vi.setSystemTime(tomorrow.cutoffAt);
    expect(
      await errorCode(
        resident.as.mutation(api.meals.saveChoices, {
          choices: [{ mealServiceId: tomorrow._id, selection: "no" }],
        }),
      ),
    ).toBe("CUTOFF_PASSED");
    expect((await responses(t))[0].selection).toBe("yes");
  });

  test("is refused on days the resident isn't counted (leave, before start)", async () => {
    const { t, property } = await setup();
    const resident = await createActiveResident(t);
    const dayAfter = addDays(TODAY, 2);
    await t.run(async (ctx) => {
      await ctx.db.insert("leaves", {
        organizationId: property.organizationId,
        propertyId: property._id,
        residentId: resident.residentId,
        startDate: dayAfter,
        endDate: dayAfter,
        status: "approved",
        requestedBy: resident.userId,
        createdAt: NOW,
      });
    });
    const onLeave = await service(t, dayAfter, "lunch");
    expect(
      await errorCode(
        resident.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: onLeave._id, selection: "yes" }] }),
      ),
    ).toBe("NOT_ELIGIBLE");

    await t.run((ctx) => ctx.db.patch(resident.residentId, { validFrom: addDays(TODAY, 5) }));
    const beforeStart = await service(t, TOMORROW, "lunch");
    expect(
      await errorCode(
        resident.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: beforeStart._id, selection: "yes" }] }),
      ),
    ).toBe("NOT_ELIGIBLE");
  });

  test("rejects empty, duplicate and cancelled-meal saves", async () => {
    const { t } = await setup();
    const resident = await createActiveResident(t);
    const snacks = await service(t, TOMORROW, "snacks");
    expect(await errorCode(resident.as.mutation(api.meals.saveChoices, { choices: [] }))).toBe("INVALID_INPUT");
    expect(
      await errorCode(
        resident.as.mutation(api.meals.saveChoices, {
          choices: [
            { mealServiceId: snacks._id, selection: "yes" },
            { mealServiceId: snacks._id, selection: "no" },
          ],
        }),
      ),
    ).toBe("INVALID_INPUT");
    await t.run((ctx) => ctx.db.patch(snacks._id, { status: "cancelled" }));
    expect(
      await errorCode(
        resident.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: snacks._id, selection: "yes" }] }),
      ),
    ).toBe("INVALID_INPUT");
    expect(await responses(t)).toHaveLength(0);
  });
});

describe("a resident's own days", () => {
  async function save(
    as: Awaited<ReturnType<typeof createActiveResident>>["as"],
    id: Id<"mealServices">,
    selection: "yes" | "no",
  ) {
    return await as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: id, selection }] });
  }

  test("shows only the caller's own choices; unanswered stays unanswered", async () => {
    const { t } = await setup();
    const asha = await createActiveResident(t, "Asha Rao", "204");
    const ravi = await createActiveResident(t, "Ravi Kumar", "205");
    const breakfast = await service(t, TOMORROW, "breakfast");
    await save(ravi.as, breakfast._id, "yes");

    const view = await asha.as.query(api.meals.myDays, { startDate: TOMORROW, days: 1 });
    expect(view.resident).toEqual({ displayName: "Asha Rao", roomNumber: "204" });
    expect(view.days[0].date).toBe(TOMORROW);
    expect(view.days[0].ineligible).toBeNull();
    expect(view.days[0].meals.map((m) => m.name)).toEqual(["Breakfast", "Lunch", "Snacks", "Dinner"]);
    expect(view.days[0].meals.every((m) => m.selection === null && m.updatedAt === null)).toBe(true);

    const { savedAt } = await save(asha.as, breakfast._id, "no");
    const after = await asha.as.query(api.meals.myDays, { startDate: TOMORROW, days: 1 });
    expect(after.days[0].meals[0]).toMatchObject({ selection: "no", updatedAt: savedAt, staffChange: null });
  });

  test("shows when staff changed a choice, with who and why", async () => {
    const { t } = await setup();
    const asha = await createActiveResident(t, "Asha Rao", "204");
    const lunch = await service(t, TOMORROW, "lunch");
    const warden = await createStaff(t, "warden", "Meena Warden");
    await t.run(async (ctx) => {
      const property = (await ctx.db.query("properties").first())!;
      await ctx.db.insert("mealResponses", {
        organizationId: property.organizationId,
        propertyId: property._id,
        mealServiceId: lunch._id,
        residentId: asha.residentId,
        selection: "no",
        version: 1,
        updatedAt: NOW,
        updatedBy: warden.userId,
      });
      await ctx.db.insert("mealActivityLog", {
        organizationId: property.organizationId,
        propertyId: property._id,
        mealServiceId: lunch._id,
        residentId: asha.residentId,
        residentName: "Asha Rao",
        roomNumber: "204",
        serviceDate: TOMORROW,
        mealType: "lunch",
        mealDisplayName: "Lunch",
        previousSelection: "none",
        newSelection: "no",
        afterCutoff: true,
        actorUserId: warden.userId,
        actorName: "Meena Warden",
        actorRole: "warden",
        source: "staff_correction",
        reason: "Told me at the desk",
        responseVersion: 1,
        createdAt: NOW,
      });
    });
    const view = await asha.as.query(api.meals.myDays, { startDate: TOMORROW, days: 1 });
    expect(view.days[0].meals[1].staffChange).toEqual({
      actorName: "Meena Warden",
      actorRole: "warden",
      reason: "Told me at the desk",
      at: NOW,
    });
  });

  test("marks days the resident isn't counted, and validates the request", async () => {
    const { t } = await setup();
    const asha = await createActiveResident(t);
    await t.run((ctx) => ctx.db.patch(asha.residentId, { validFrom: addDays(TODAY, 2) }));
    const view = await asha.as.query(api.meals.myDays, { startDate: TODAY, days: 3 });
    expect(view.days.map((d) => d.ineligible)).toEqual(["before_start", "before_start", null]);
    expect(await errorCode(asha.as.query(api.meals.myDays, { startDate: "24-10-2026", days: 1 }))).toBe(
      "INVALID_INPUT",
    );
    expect(await errorCode(asha.as.query(api.meals.myDays, { startDate: TODAY, days: 15 }))).toBe("INVALID_INPUT");
  });

  test("pending residents and staff can't read it", async () => {
    const { t } = await setup();
    const pending = await createSignedUp(t);
    expect(await errorCode(pending.as.query(api.meals.myDays, { startDate: TODAY, days: 1 }))).toBe(
      "RESIDENT_NOT_ACTIVE",
    );
    const warden = await createStaff(t, "warden");
    expect(await errorCode(warden.as.query(api.meals.myDays, { startDate: TODAY, days: 1 }))).toBe("FORBIDDEN");
    expect(await errorCode(t.query(api.meals.myDays, { startDate: TODAY, days: 1 }))).toBe("NOT_SIGNED_IN");
  });
});
