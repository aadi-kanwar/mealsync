import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  addProperty,
  createActiveResident,
  createProperty,
  createSignedUp,
  createStaff,
  errorCode,
  setupTest,
  type T,
} from "./harness.test-utils";

// Sat 24 Oct 2026, 18:00 IST.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 24, 12, 30));
});
afterEach(() => {
  vi.useRealTimers();
});

const PASSWORD = "plain-tea-42";

/** Two PGs in one organisation, meals ready for the coming week. */
async function twoProperties() {
  const t = await setupTest();
  const first = await createProperty(t);
  const second = await addProperty(t, "Second PG");
  await t.mutation(internal.meals.generateUpcoming, {});
  return { t, first, second };
}

async function lunchOn(t: T, propertyId: string, date: string) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("mealServices").collect()).find(
      (s) => s.propertyId === propertyId && s.serviceDate === date && s.mealType === "lunch",
    )!,
  );
}

describe("organisations", () => {
  test("an Admin signs up with their organisation and first PG; residents can then pick it", async () => {
    const t = await setupTest();
    await t.action(api.auth.signIn, {
      provider: "phone-password",
      params: {
        flow: "signUp",
        account: "organization",
        phone: "9811100001",
        password: PASSWORD,
        displayName: "Ravi Owner",
        organizationName: "Sunrise Stays",
        propertyName: "Sunrise PG",
      },
    });
    const directory = await t.query(api.directory.list, {});
    expect(directory).toMatchObject([{ name: "Sunrise Stays", properties: [{ name: "Sunrise PG" }] }]);
    const propertyId = directory[0].properties[0].propertyId;

    // A resident picks that PG at sign-up and waits for its staff.
    await t.action(api.auth.signIn, {
      provider: "phone-password",
      params: { flow: "signUp", phone: "9811100002", password: PASSWORD, displayName: "Asha Rao", roomNumber: "12", propertyId },
    });
    const resident = await t.run(async (ctx) => (await ctx.db.query("residents").collect())[0]);
    expect(resident).toMatchObject({ propertyId, status: "pending" });
    const roles = await t.run((ctx) => ctx.db.query("staffRoles").collect());
    expect(roles.map((r) => [r.role, r.propertyId ?? "every PG"])).toEqual([["admin", "every PG"]]);

    // An unknown PG is refused before any account is made.
    expect(
      await errorCode(
        t.action(api.auth.signIn, {
          provider: "phone-password",
          params: { flow: "signUp", phone: "9811100003", password: PASSWORD, displayName: "Bina Das", roomNumber: "3", propertyId: "nope" },
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(await t.run(async (ctx) => (await ctx.db.query("users").collect()).length)).toBe(2);
  });

  test("Admins only ever see their own organisation", async () => {
    const t = await setupTest();
    const mine = await createProperty(t);
    const admin = await createStaff(t, "admin");
    const other = await t.run(async (ctx) => {
      const { createOrganization, createProperty: makeProperty } = await import("../lib/property");
      const org = await createOrganization(ctx, { name: "Other Org", createdBy: undefined });
      return await makeProperty(ctx, { organizationId: org._id, name: "Other PG", createdBy: undefined });
    });
    await createActiveResident(t, "Someone Else", "9", other._id);
    expect((await admin.as.query(api.users.me, {}))?.staff?.properties.map((p) => p.name)).toEqual([mine.name]);
    expect(await errorCode(admin.as.query(api.residents.list, { propertyId: other._id }))).toBe("FORBIDDEN");
    expect(await admin.as.query(api.residents.list, {})).toEqual([]);
    // Someone already staff elsewhere can't be added.
    const otherAdmin = await createSignedUp(t, "Other Admin", "1", other._id);
    await t.run((ctx) =>
      ctx.db.insert("staffRoles", {
        organizationId: other.organizationId,
        userId: otherAdmin.userId,
        role: "admin",
        status: "active",
        grantedAt: 0,
      }),
    );
    expect(
      await errorCode(admin.as.mutation(api.staff.grantRole, { phone: otherAdmin.phone, role: "warden", propertyIds: [mine._id] })),
    ).toBe("CONFLICT");
  });
});

describe("several properties", () => {
  test("a Warden sees and manages only the PGs they're assigned to", async () => {
    const { t, first, second } = await twoProperties();
    const warden = await createStaff(t, "warden", "Meena Warden", [first._id]);
    const here = await createActiveResident(t, "Here Resident", "1", first._id);
    const there = await createActiveResident(t, "There Resident", "2", second._id);
    const pendingThere = await createSignedUp(t, "Pending There", "3", second._id);

    expect((await warden.as.query(api.residents.list, {})).map((r) => r.displayName)).toEqual(["Here Resident"]);
    expect(await warden.as.query(api.residents.pendingCount, {})).toBe(0);
    for (const call of [
      warden.as.query(api.residents.list, { propertyId: second._id }),
      warden.as.query(api.dashboard.day, { propertyId: second._id, date: "2026-10-25" }),
    ]) {
      expect(await errorCode(call)).toBe("FORBIDDEN");
    }
    for (const call of [
      warden.as.mutation(api.residents.moveOut, { residentId: there.residentId, lastDay: "2026-10-30" }),
      warden.as.mutation(api.residents.updateDetails, { residentId: there.residentId, displayName: "X Y", roomNumber: "9" }),
      warden.as.mutation(api.residents.approve, { residentId: pendingThere.residentId, roomNumber: "3", validFrom: "2026-10-25" }),
      warden.as.action(api.residents.resetPassword, { residentId: there.residentId }),
    ]) {
      expect(await errorCode(call)).toBe("NOT_FOUND");
    }
    await warden.as.mutation(api.residents.updateDetails, { residentId: here.residentId, displayName: "Here Resident", roomNumber: "1A" });

    // The Admin adds the second PG to the Warden's list.
    const admin = await createStaff(t, "admin");
    await admin.as.mutation(api.staff.setProperties, { userId: warden.userId, propertyIds: [first._id, second._id] });
    const staff = await admin.as.query(api.staff.list, {});
    expect(staff.find((s) => s.userId === warden.userId)?.propertyIds.sort()).toEqual([first._id, second._id].sort());
    expect(await warden.as.query(api.residents.pendingCount, {})).toBe(1);
    expect(
      (await warden.as.query(api.residents.list, { propertyId: second._id })).map((r) => [r.displayName, r.propertyName]),
    ).toEqual([["There Resident", "Second PG"]]);
    expect(await errorCode(admin.as.mutation(api.staff.setProperties, { userId: warden.userId, propertyIds: [] }))).toBe(
      "INVALID_INPUT",
    );
    const actions = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(actions).toContain("staff.properties_updated");
  });

  test("the dashboard shows one PG, or all of them added up with each PG alongside", async () => {
    const { t, first, second } = await twoProperties();
    const admin = await createStaff(t, "admin");
    const a = await createActiveResident(t, "Asha Rao", "1", first._id);
    const b = await createActiveResident(t, "Bina Das", "2", second._id);
    await createActiveResident(t, "Chitra Iyer", "3", second._id);
    await a.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: (await lunchOn(t, first._id, "2026-10-25"))._id, selection: "yes" }] });
    await b.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: (await lunchOn(t, second._id, "2026-10-25"))._id, selection: "no" }] });

    const one = await admin.as.query(api.dashboard.day, { propertyId: second._id, date: "2026-10-25" });
    expect(one.properties).toEqual([]);
    expect(one.meals.find((m) => m.mealType === "lunch")?.counts).toMatchObject({ eligible: 2, yes: 0, no: 1, unanswered: 1 });

    const all = await admin.as.query(api.dashboard.day, { date: "2026-10-25" });
    expect(all.meals.find((m) => m.mealType === "lunch")?.counts).toMatchObject({ eligible: 3, yes: 1, no: 1, unanswered: 1 });
    expect(all.properties.map((p) => [p.name, p.meals.find((m) => m.mealType === "lunch")?.counts.yes])).toEqual([
      ["Second PG", 0],
      ["Test PG", 1],
    ]);

    const responses = await admin.as.query(api.dashboard.responses, { date: "2026-10-25" });
    expect(responses.residents.map((r) => [r.propertyName, r.displayName])).toEqual([
      ["Second PG", "Bina Das"],
      ["Second PG", "Chitra Iyer"],
      ["Test PG", "Asha Rao"],
    ]);
    // Screens about one PG need one chosen.
    expect(await errorCode(admin.as.query(api.menus.get, {}))).toBe("CHOOSE_PROPERTY");
    expect((await admin.as.query(api.menus.get, { propertyId: second._id })).menus).toHaveLength(2);
  });

  test("reminders go out for every PG at its own times", async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 24, 15, 32)); // 21:02 IST
    const { t, first, second } = await twoProperties();
    await t.run((ctx) => ctx.db.patch(second._id, { reminderTimes: ["22:00"] }));
    const device = (n: number) => ({ endpoint: `https://push.example.com/${n}`, p256dh: "p".repeat(87), auth: "a".repeat(22) });
    const a = await createActiveResident(t, "Asha Rao", "1", first._id);
    const b = await createActiveResident(t, "Bina Das", "2", second._id);
    await a.as.mutation(api.notifications.subscribe, device(1));
    await b.as.mutation(api.notifications.subscribe, device(2));
    expect(await t.mutation(internal.notifications.sendDueReminders, {})).toEqual({ sent: 1 });
    vi.setSystemTime(Date.UTC(2026, 9, 24, 16, 31)); // 22:01 IST
    expect(await t.mutation(internal.notifications.sendDueReminders, {})).toEqual({ sent: 1 });
    const runs = await t.run((ctx) => ctx.db.query("reminderRuns").collect());
    expect(runs.map((r) => [r.propertyId, r.time])).toEqual([
      [first._id, "21:00"],
      [second._id, "22:00"],
    ]);
  });
});

test("each PG has its own menu, and residents see their own PG's dishes", async () => {
  const { t, first, second } = await twoProperties();
  const admin = await createStaff(t, "admin");
  const a = await createActiveResident(t, "Asha Rao", "1", first._id);
  const b = await createActiveResident(t, "Bina Das", "2", second._id);
  // Sunday 25 Oct: weekday 0.
  for (const [property, dish] of [
    [first, "Poha"],
    [second, "Idli"],
  ] as const) {
    await admin.as.mutation(api.menus.save, {
      propertyId: property._id,
      label: "A",
      entries: [{ weekday: 0, mealType: "breakfast", items: dish }],
    });
    await admin.as.mutation(api.menus.setThisWeek, { propertyId: property._id, label: "A" });
  }
  const firstMenu = await admin.as.query(api.menus.get, { propertyId: first._id });
  const secondMenu = await admin.as.query(api.menus.get, { propertyId: second._id });
  expect(firstMenu.menus[0].entries).toEqual([{ weekday: 0, mealType: "breakfast", items: "Poha" }]);
  expect(secondMenu.menus[0].entries).toEqual([{ weekday: 0, mealType: "breakfast", items: "Idli" }]);

  const dishFor = async (as: typeof a.as) =>
    (await as.query(api.meals.myDays, { startDate: "2026-10-25", days: 1 })).days[0].meals.find(
      (m) => m.mealType === "breakfast",
    )?.menu;
  expect(await dishFor(a.as)).toBe("Poha");
  expect(await dishFor(b.as)).toBe("Idli");

  // A Warden of one PG can't touch another PG's menu (menus are Admin-only anyway).
  const warden = await createStaff(t, "warden", "Meena Warden", [first._id]);
  expect(await errorCode(warden.as.query(api.menus.get, { propertyId: second._id }))).toBe("FORBIDDEN");
});
