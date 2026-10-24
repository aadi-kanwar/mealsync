import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  createActiveResident,
  createProperty,
  createSignedUp,
  createStaff,
  errorCode,
  setupTest,
  type T,
} from "./harness.test-utils";

// Sat 24 Oct 2026, 18:00 IST.
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
  const warden = await createStaff(t, "warden", "Meena Warden");
  const admin = await createStaff(t, "admin", "Owner Admin");
  return { t, property, warden, admin };
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
    const { t, warden } = await setup();
    await typicalDay(t);
    const day = await warden.as.query(api.dashboard.day, { date: TODAY });
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
    const { t, warden } = await setup();
    await createActiveResident(t);
    await createSignedUp(t); // pending
    const rejected = await createSignedUp(t);
    const movedOut = await createActiveResident(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(rejected.residentId, { status: "rejected" });
      await ctx.db.patch(movedOut.residentId, { status: "inactive" });
    });
    const day = await warden.as.query(api.dashboard.day, { date: TODAY });
    expect(lunchOf(day).counts.eligible).toBe(1);
  });

  test("leave and stay dates decide who is counted; an answer from someone not counted is shown apart", async () => {
    const { t, property, warden } = await setup();
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
    const day = await warden.as.query(api.dashboard.day, { date: TODAY });
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
    const { t, warden } = await setup();
    const { people, lunch } = await typicalDay(t);
    await answer(t, people[0].residentId, lunch._id, "no"); // a duplicate answer that should never exist
    const day = await warden.as.query(api.dashboard.day, { date: TODAY });
    expect(lunchOf(day).counts.balanced).toBe(false);
  });
});

describe("who can see what", () => {
  test("residents and signed-out visitors can't open staff screens", async () => {
    const { t } = await setup();
    const resident = await createActiveResident(t);
    for (const call of [
      resident.as.query(api.dashboard.day, { date: TODAY }),
      resident.as.query(api.dashboard.nonResponders, { date: TODAY }),
      resident.as.mutation(api.meals.ensureUpcomingForStaff, {}),
    ]) {
      expect(await errorCode(call)).toBe("FORBIDDEN");
    }
    expect(await errorCode(t.query(api.dashboard.day, { date: TODAY }))).toBe("NOT_SIGNED_IN");
  });

  test("Warden and Admin see names and rooms of non-responders, never phone numbers", async () => {
    const { t, warden, admin } = await setup();
    await typicalDay(t);
    for (const staff of [warden, admin]) {
      const data = await staff.as.query(api.dashboard.nonResponders, { date: TODAY });
      const lunch = data.meals.find((m) => m.name === "Lunch")!;
      expect(lunch.people.map((p) => [p.roomNumber, p.displayName])).toEqual([
        ["104", "Resident 104"],
        ["105", "Resident 105"],
      ]);
      expect(JSON.stringify(data)).not.toMatch(/\+91/);
    }
  });

  test("dates are validated", async () => {
    const { warden } = await setup();
    expect(await errorCode(warden.as.query(api.dashboard.day, { date: "2026-13-01" }))).toBe("INVALID_INPUT");
  });
});
