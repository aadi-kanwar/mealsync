import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { csvCell } from "../lib/csv";
import { bufferFor } from "../lib/headcount";
import {
  createActiveResident,
  createProperty,
  createSignedUp,
  createStaff,
  errorCode,
  setupTest,
  type T,
} from "./harness.test-utils";

// Sat 24 Oct 2026, 18:00 IST. Today's meals closed yesterday at 21:00;
// tomorrow's close today at 21:00.
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
  const kitchen = await createStaff(t, "kitchen", "Ravi Cook");
  const warden = await createStaff(t, "warden", "Meena Warden");
  const admin = await createStaff(t, "admin", "Owner Admin");
  return { t, property, kitchen, warden, admin };
}

async function service(t: T, date: string, mealType: Doc<"mealServices">["mealType"]) {
  return await t.run(async (ctx) => {
    const all = await ctx.db.query("mealServices").collect();
    return all.find((s) => s.serviceDate === date && s.mealType === mealType)!;
  });
}

/** Writes an answer directly (as if saved before the cutoff). */
async function answer(t: T, residentId: Id<"residents">, serviceId: Id<"mealServices">, selection: "yes" | "no") {
  await t.run(async (ctx) => {
    const property = (await ctx.db.query("properties").first())!;
    const resident = (await ctx.db.get(residentId))!;
    await ctx.db.insert("mealResponses", {
      organizationId: property.organizationId,
      propertyId: property._id,
      mealServiceId: serviceId,
      residentId,
      selection,
      version: 1,
      updatedAt: NOW,
      updatedBy: resident.userId,
    });
  });
}

/** Five active residents (rooms 101-105); 101, 102 say Yes, 103 says No, 104 and 105 don't answer. */
async function typicalDay(t: T, date = TODAY) {
  const people = [];
  for (const room of ["101", "102", "103", "104", "105"]) {
    people.push(await createActiveResident(t, `Resident ${room}`, room));
  }
  const lunch = await service(t, date, "lunch");
  await answer(t, people[0].residentId, lunch._id, "yes");
  await answer(t, people[1].residentId, lunch._id, "yes");
  await answer(t, people[2].residentId, lunch._id, "no");
  return { people, lunch };
}

const lunchOf = <M extends { mealType: string }>(day: { meals: M[] }) => day.meals.find((m) => m.mealType === "lunch")!;

describe("headcount", () => {
  test("eligible, Yes, No and Not answered are separate, and N = Y + O + U", async () => {
    const { t, kitchen } = await setup();
    await typicalDay(t);
    const day = await kitchen.as.query(api.kitchen.day, { date: TODAY });
    expect(day.meals.map((m) => m.name)).toEqual(["Breakfast", "Lunch", "Snacks", "Dinner"]);
    expect(lunchOf(day).counts).toEqual({
      eligible: 5,
      yes: 2,
      no: 1,
      unanswered: 2,
      balanced: true,
      notCounted: 0,
    });
    expect(day.meals[0].counts).toMatchObject({ eligible: 5, yes: 0, no: 0, unanswered: 5 });
  });

  test("pending, rejected and inactive residents are never counted", async () => {
    const { t, kitchen } = await setup();
    await createActiveResident(t);
    await createSignedUp(t); // pending
    const rejected = await createSignedUp(t);
    const movedOut = await createActiveResident(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(rejected.residentId, { status: "rejected" });
      await ctx.db.patch(movedOut.residentId, { status: "inactive" });
    });
    const day = await kitchen.as.query(api.kitchen.day, { date: TODAY });
    expect(lunchOf(day).counts.eligible).toBe(1);
  });

  test("leave and stay dates decide who is counted; an answer from someone not counted is shown apart", async () => {
    const { t, property, kitchen } = await setup();
    const { people } = await typicalDay(t);
    await t.run(async (ctx) => {
      // Resident 101 answered Yes, then went on leave covering today.
      await ctx.db.insert("leaves", {
        organizationId: property.organizationId,
        propertyId: property._id,
        residentId: people[0].residentId,
        startDate: TODAY,
        endDate: TOMORROW,
        status: "approved",
        requestedBy: people[0].userId,
        createdAt: NOW,
      });
      // A leave that's only requested doesn't count.
      await ctx.db.insert("leaves", {
        organizationId: property.organizationId,
        propertyId: property._id,
        residentId: people[1].residentId,
        startDate: TODAY,
        endDate: TODAY,
        status: "pending",
        requestedBy: people[1].userId,
        createdAt: NOW,
      });
      // Resident 105 starts tomorrow.
      await ctx.db.patch(people[4].residentId, { validFrom: TOMORROW });
    });
    const day = await kitchen.as.query(api.kitchen.day, { date: TODAY });
    expect(lunchOf(day).counts).toEqual({
      eligible: 3,
      yes: 1,
      no: 1,
      unanswered: 1,
      balanced: true,
      notCounted: 1,
    });
  });

  test("a broken count is reported, never hidden", async () => {
    const { t, kitchen } = await setup();
    const { people, lunch } = await typicalDay(t);
    await answer(t, people[0].residentId, lunch._id, "no"); // a duplicate answer that should never exist
    const day = await kitchen.as.query(api.kitchen.day, { date: TODAY });
    expect(lunchOf(day).counts.balanced).toBe(false);
  });

  test("buffer: a fixed number, or a percentage of non-responders rounded up", () => {
    expect(bufferFor({ kind: "fixed", value: 3 }, 40)).toBe(3);
    expect(bufferFor({ kind: "percent_of_unanswered", value: 10 }, 41)).toBe(5);
    expect(bufferFor({ kind: "percent_of_unanswered", value: 10 }, 0)).toBe(0);
  });
});

describe("who can see what", () => {
  test("residents and signed-out visitors can't open staff screens", async () => {
    const { t } = await setup();
    const resident = await createActiveResident(t);
    for (const call of [
      resident.as.query(api.kitchen.day, { date: TODAY }),
      resident.as.query(api.kitchen.nonResponders, { date: TODAY }),
      resident.as.mutation(api.kitchen.exportDayCsv, { date: TODAY }),
      resident.as.mutation(api.meals.ensureUpcomingForStaff, {}),
    ]) {
      expect(await errorCode(call)).toBe("FORBIDDEN");
    }
    expect(await errorCode(t.query(api.kitchen.day, { date: TODAY }))).toBe("NOT_SIGNED_IN");
  });

  test("Warden sees names and rooms of non-responders; Kitchen sees rooms only; nobody sees phones", async () => {
    const { t, warden, kitchen } = await setup();
    await typicalDay(t);
    const forWarden = await warden.as.query(api.kitchen.nonResponders, { date: TODAY });
    const lunch = forWarden.meals.find((m) => m.name === "Lunch")!;
    expect(lunch.people.map((p) => [p.roomNumber, p.displayName])).toEqual([
      ["104", "Resident 104"],
      ["105", "Resident 105"],
    ]);
    const forKitchen = await kitchen.as.query(api.kitchen.nonResponders, { date: TODAY });
    expect(forKitchen.showNames).toBe(false);
    expect(forKitchen.meals.flatMap((m) => m.people).every((p) => p.displayName === null)).toBe(true);
    expect(JSON.stringify([forWarden, forKitchen])).not.toMatch(/\+91/);
  });

  test("dates are validated", async () => {
    const { kitchen } = await setup();
    expect(await errorCode(kitchen.as.query(api.kitchen.day, { date: "2026-13-01" }))).toBe("INVALID_INPUT");
  });
});

describe("finalizing the kitchen report", () => {
  test("is refused before the cutoff", async () => {
    const { t, kitchen } = await setup();
    const lunch = await service(t, TOMORROW, "lunch");
    expect(
      await errorCode(
        kitchen.as.mutation(api.kitchen.finalize, {
          mealServiceId: lunch._id,
          bufferRule: { kind: "fixed", value: 0 },
          finalTarget: 0,
        }),
      ),
    ).toBe("CONFLICT");
  });

  test("recalculates counts, stores the approved target, and versions every change", async () => {
    const { t, kitchen, admin, warden } = await setup();
    const { people, lunch } = await typicalDay(t);
    const finalize = (finalTarget: number, as = kitchen.as) =>
      as.mutation(api.kitchen.finalize, {
        mealServiceId: lunch._id,
        bufferRule: { kind: "percent_of_unanswered", value: 50 },
        finalTarget,
      });

    // The target must be Yes (2) + 50% of 2 non-responders (1) = 3.
    expect(await errorCode(finalize(10))).toBe("CONFLICT");
    expect(await errorCode(finalize(3, warden.as))).toBe("FORBIDDEN");
    expect(await finalize(3)).toEqual({ version: 1, finalTarget: 3 });
    expect(await errorCode(finalize(3))).toBe("CONFLICT"); // already finalized

    const day = await kitchen.as.query(api.kitchen.day, { date: TODAY });
    expect(lunchOf(day)).toMatchObject({
      report: { version: 1, status: "finalized", bufferApplied: 1, finalTarget: 3 },
      finalizedByName: "Ravi Cook",
    });

    // Only an Admin can reopen; that's a new version, and v1 is untouched.
    expect(await errorCode(kitchen.as.mutation(api.kitchen.reopen, { mealServiceId: lunch._id }))).toBe("FORBIDDEN");
    expect(await admin.as.mutation(api.kitchen.reopen, { mealServiceId: lunch._id })).toEqual({ version: 2 });
    expect(await errorCode(admin.as.mutation(api.kitchen.reopen, { mealServiceId: lunch._id }))).toBe("CONFLICT");

    // Resident 104's answer is added in the meantime (corrections arrive in Phase 4).
    await answer(t, people[3].residentId, lunch._id, "yes");
    // Yes is now 3, one non-responder -> buffer ceil(0.5) = 1 -> target 4.
    expect(await finalize(4)).toEqual({ version: 3, finalTarget: 4 });

    const versions = await warden.as.query(api.kitchen.reportVersions, { mealServiceId: lunch._id });
    expect(versions.map((v) => [v.version, v.status, v.confirmedCount, v.finalTarget, v.byName])).toEqual([
      [3, "finalized", 3, 4, "Ravi Cook"],
      [2, "draft", 2, 3, "Owner Admin"],
      [1, "finalized", 2, 3, "Ravi Cook"],
    ]);
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.filter((a) => a.action.startsWith("report.")).map((a) => a.action)).toEqual([
      "report.finalized",
      "report.reopened",
      "report.finalized",
    ]);
  });

  test("checks the buffer", async () => {
    const { t, kitchen } = await setup();
    const lunch = await service(t, TODAY, "lunch");
    for (const bufferRule of [
      { kind: "fixed" as const, value: -1 },
      { kind: "fixed" as const, value: 1.5 },
      { kind: "percent_of_unanswered" as const, value: 101 },
    ]) {
      expect(
        await errorCode(kitchen.as.mutation(api.kitchen.finalize, { mealServiceId: lunch._id, bufferRule, finalTarget: 0 })),
      ).toBe("INVALID_INPUT");
    }
  });

  test("is refused when the counts don't add up", async () => {
    const { t, kitchen } = await setup();
    const { people, lunch } = await typicalDay(t);
    await answer(t, people[0].residentId, lunch._id, "yes");
    expect(
      await errorCode(
        kitchen.as.mutation(api.kitchen.finalize, {
          mealServiceId: lunch._id,
          bufferRule: { kind: "fixed", value: 0 },
          finalTarget: 3,
        }),
      ),
    ).toBe("CONFLICT");
  });
});

describe("recording actuals", () => {
  const good = { preparedCount: 40, servedCount: 32, leftoverCount: 5, discardedCount: 3 };

  test("validates the numbers", async () => {
    const { t, kitchen } = await setup();
    const lunch = await service(t, TODAY, "lunch");
    const record = (values: Partial<typeof good> & { discardedWeightGrams?: number; notes?: string }) =>
      errorCode(kitchen.as.mutation(api.kitchen.recordActuals, { mealServiceId: lunch._id, ...good, ...values }));
    expect(await record({ servedCount: 41 })).toBe("INVALID_INPUT");
    expect(await record({ leftoverCount: 6 })).toBe("INVALID_INPUT"); // 6 + 3 > 40 - 32
    expect(await record({ discardedCount: -1 })).toBe("INVALID_INPUT");
    expect(await record({ preparedCount: 40.5 })).toBe("INVALID_INPUT");
    expect(await record({ discardedWeightGrams: -5 })).toBe("INVALID_INPUT");
    expect(await record({ notes: "x".repeat(501) })).toBe("INVALID_INPUT");
    const tomorrow = await service(t, TOMORROW, "lunch");
    expect(
      await errorCode(kitchen.as.mutation(api.kitchen.recordActuals, { mealServiceId: tomorrow._id, ...good })),
    ).toBe("INVALID_INPUT");
    expect(await t.run((ctx) => ctx.db.query("actualCounts").collect())).toHaveLength(0);
  });

  test("keeps one record per meal and audits every change with the old values", async () => {
    const { t, kitchen, warden } = await setup();
    const lunch = await service(t, TODAY, "lunch");
    expect(
      await errorCode(warden.as.mutation(api.kitchen.recordActuals, { mealServiceId: lunch._id, ...good })),
    ).toBe("FORBIDDEN");
    await kitchen.as.mutation(api.kitchen.recordActuals, { mealServiceId: lunch._id, ...good });
    await kitchen.as.mutation(api.kitchen.recordActuals, {
      mealServiceId: lunch._id,
      ...good,
      discardedWeightGrams: 1200,
      notes: "  Rice left over  ",
    });
    const rows = await t.run((ctx) => ctx.db.query("actualCounts").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...good, discardedWeightGrams: 1200, notes: "Rice left over" });
    const day = await kitchen.as.query(api.kitchen.day, { date: TODAY });
    expect(lunchOf(day).actuals).toMatchObject({ ...good, discardedWeightGrams: 1200 });
    const audit = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).filter(
      (a) => a.action === "actuals.recorded",
    );
    expect(audit).toHaveLength(2);
    expect(audit[0].metadata.previous).toBeNull();
    expect(audit[1].metadata.previous).toMatchObject({ ...good, discardedWeightGrams: null });
  });
});

describe("CSV export", () => {
  test("has every count and actual, in local time, and is audited", async () => {
    const { t, kitchen, warden } = await setup();
    const { lunch } = await typicalDay(t);
    await kitchen.as.mutation(api.kitchen.finalize, {
      mealServiceId: lunch._id,
      bufferRule: { kind: "fixed", value: 2 },
      finalTarget: 4,
    });
    await kitchen.as.mutation(api.kitchen.recordActuals, {
      mealServiceId: lunch._id,
      preparedCount: 5,
      servedCount: 4,
      leftoverCount: 1,
      discardedCount: 0,
      notes: "=HYPERLINK(\"x\")",
    });
    const { filename, csv } = await warden.as.mutation(api.kitchen.exportDayCsv, { date: TODAY });
    expect(filename).toBe("mealsync-kitchen-2026-10-24.csv");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("Eligible (N),Yes (Y),No (O),Not answered (U),N = Y + O + U");
    expect(lines[2]).toBe(
      [
        "2026-10-24,Lunch,13:00,2026-10-23 21:00,5,2,1,2,OK,Finalized,1,2,4,Ravi Cook,2026-10-24 18:00",
        "5,4,1,1,0,,\"'=HYPERLINK(\"\"x\"\")\"",
      ].join(","),
    );
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.at(-1)).toMatchObject({ action: "export.kitchen_csv", actorUserId: warden.userId });
  });

  test("cells are quoted and protected from spreadsheet formulas", () => {
    expect(csvCell("Plain")).toBe("Plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-5 portions")).toBe("'-5 portions");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
  });
});
