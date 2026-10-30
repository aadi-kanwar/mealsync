import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
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
const DAY_MS = 86_400_000;
const PASSWORD = "plain-tea-42";

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
  const warden = await createStaff(t, "warden", "Meena Warden");
  return { t, warden };
}

async function signIn(t: T, flow: "signIn" | "signUp", phone: string, password: string) {
  const propertyId = await t.run(async (ctx) => (await ctx.db.query("properties").first())!._id);
  return await t.action(api.auth.signIn, {
    provider: "phone-password",
    params: { flow, phone, password, displayName: "Asha Rao", roomNumber: "204", propertyId },
  });
}

/** A real account (with a password) that's an approved resident, and a client signed in as it. */
async function realResident(t: T, phone = "9876543210") {
  await signIn(t, "signUp", phone, PASSWORD);
  const ids = await t.run(async (ctx) => {
    const user = (await ctx.db.query("users").collect()).find((u) => u.phone === `+91${phone}`)!;
    const resident = (await ctx.db
      .query("residents")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique())!;
    await ctx.db.patch(resident._id, { status: "active", validFrom: "2026-01-01" });
    const session = (await ctx.db.query("authSessions").collect()).find((s) => s.userId === user._id)!;
    return { userId: user._id, residentId: resident._id, sessionId: session._id };
  });
  return { ...ids, as: t.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` }) };
}

const counted = async (as: Awaited<ReturnType<typeof createStaff>>["as"], date: string) =>
  (await as.query(api.dashboard.day, { date })).meals[0].counts.eligible;

describe("moving out", () => {
  test("the resident is counted up to their last day and not after; history is kept", async () => {
    const { t, warden } = await setup();
    const resident = await createActiveResident(t, "Ravi Kumar", "105");
    const tomorrow = "2026-10-25";
    expect(await counted(warden.as, tomorrow)).toBe(1);

    await warden.as.mutation(api.residents.moveOut, { residentId: resident.residentId, lastDay: TODAY });
    expect(await counted(warden.as, TODAY)).toBe(1);
    expect(await counted(warden.as, tomorrow)).toBe(0);
    const rows = await warden.as.query(api.residents.list, {});
    expect(rows[0]).toMatchObject({ displayName: "Ravi Kumar", status: "active", validUntil: TODAY });

    // The nightly job only closes the stay once the last day has passed.
    expect(await t.mutation(internal.residents.endStays, {})).toBe(0);
    vi.setSystemTime(NOW + DAY_MS);
    expect(await t.mutation(internal.residents.endStays, {})).toBe(1);
    expect((await warden.as.query(api.residents.list, {}))[0].status).toBe("inactive");
    expect((await resident.as.query(api.users.me, {}))?.resident?.status).toBe("inactive");
    expect(await errorCode(resident.as.query(api.meals.myDays, { startDate: TODAY, days: 1 }))).toBe(
      "RESIDENT_NOT_ACTIVE",
    );

    const actions = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["resident.moved_out", "resident.stay_ended"]));
  });

  test("a mistaken move-out can be undone while they're still current", async () => {
    const { t, warden } = await setup();
    const resident = await createActiveResident(t);
    await warden.as.mutation(api.residents.moveOut, { residentId: resident.residentId, lastDay: "2026-10-30" });
    await warden.as.mutation(api.residents.cancelMoveOut, { residentId: resident.residentId });
    expect((await warden.as.query(api.residents.list, {}))[0].validUntil).toBeNull();
    expect(await errorCode(warden.as.mutation(api.residents.cancelMoveOut, { residentId: resident.residentId }))).toBe(
      "CONFLICT",
    );
  });

  test("the last day can't be far in the past or before they started", async () => {
    const { t, warden } = await setup();
    const resident = await createActiveResident(t);
    const move = (lastDay: string) => errorCode(warden.as.mutation(api.residents.moveOut, { residentId: resident.residentId, lastDay }));
    expect(await move("2026-10-22")).toBe("INVALID_INPUT");
    expect(await move("2025-12-31")).toBe("INVALID_INPUT");
    expect(await move("24-10-2026")).toBe("INVALID_INPUT");
    expect(await move("2026-10-23")).toBe("NO_ERROR"); // yesterday is allowed
  });

  test("only staff can move people out, and only current residents", async () => {
    const { t, warden } = await setup();
    const resident = await createActiveResident(t);
    const other = await createActiveResident(t);
    expect(
      await errorCode(other.as.mutation(api.residents.moveOut, { residentId: resident.residentId, lastDay: TODAY })),
    ).toBe("FORBIDDEN");
    expect(await errorCode(other.as.query(api.residents.list, {}))).toBe("FORBIDDEN");
    const pending = await createSignedUp(t);
    expect(
      await errorCode(warden.as.mutation(api.residents.moveOut, { residentId: pending.residentId, lastDay: TODAY })),
    ).toBe("CONFLICT");
  });
});

describe("password reset by staff", () => {
  test("gives a temporary password, signs the resident out, and makes them choose a new one", async () => {
    const { t, warden } = await setup();
    const resident = await realResident(t);
    const { temporaryPassword } = await warden.as.action(api.residents.resetPassword, {
      residentId: resident.residentId,
    });
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);

    // The device that was signed in is signed out at once.
    expect(await resident.as.query(api.users.me, {})).toBeNull();
    expect(await errorCode(resident.as.query(api.meals.myDays, { startDate: TODAY, days: 1 }))).toBe("NOT_SIGNED_IN");

    // Old sessions are gone; the old password no longer works; the temporary one does.
    expect(
      await t.run(async (ctx) => (await ctx.db.query("authSessions").collect()).filter((s) => s.userId === resident.userId)),
    ).toHaveLength(0);
    expect(await errorCode(signIn(t, "signIn", "9876543210", PASSWORD))).toBe("SIGN_IN_FAILED");
    expect((await signIn(t, "signIn", "9876543210", temporaryPassword)).tokens?.token).toBeTruthy();

    const rows = await warden.as.query(api.residents.list, {});
    expect(rows[0].mustChangePassword).toBe(true);
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.map((a) => a.action)).toContain("resident.password_reset");
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
  });

  test("can't be used on staff accounts, by residents, or on people who aren't current residents", async () => {
    const { t, warden } = await setup();
    const resident = await realResident(t);
    const other = await realResident(t, "9123456780");
    expect(
      await errorCode(other.as.action(api.residents.resetPassword, { residentId: resident.residentId })),
    ).toBe("FORBIDDEN");

    // A resident who is also an Admin: a Warden must not be able to take over the account.
    await t.run(async (ctx) => {
      const property = (await ctx.db.query("properties").first())!;
      await ctx.db.insert("staffRoles", {
        organizationId: property.organizationId,
        propertyId: property._id,
        userId: resident.userId,
        role: "admin",
        status: "active",
        grantedAt: NOW,
      });
    });
    expect(
      await errorCode(warden.as.action(api.residents.resetPassword, { residentId: resident.residentId })),
    ).toBe("FORBIDDEN");
    expect((await signIn(t, "signIn", "9876543210", PASSWORD)).tokens?.token).toBeTruthy();

    const pending = await createSignedUp(t);
    expect(await errorCode(warden.as.action(api.residents.resetPassword, { residentId: pending.residentId }))).toBe(
      "CONFLICT",
    );
  });
});

describe("changing your own password", () => {
  test("needs the current password", async () => {
    const { t } = await setup();
    const resident = await realResident(t);
    expect(
      await errorCode(
        resident.as.action(api.users.changePassword, { currentPassword: "wrong-one", newPassword: "new-tea-77" }),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(resident.as.action(api.users.changePassword, { currentPassword: PASSWORD, newPassword: "short" })),
    ).toBe("WEAK_PASSWORD");
    await resident.as.action(api.users.changePassword, { currentPassword: PASSWORD, newPassword: "new-tea-77" });
    expect(await errorCode(signIn(t, "signIn", "9876543210", PASSWORD))).toBe("SIGN_IN_FAILED");
    expect((await signIn(t, "signIn", "9876543210", "new-tea-77")).tokens?.token).toBeTruthy();
  });

  test("right after a reset, the new password is set without the current one, and the flag clears", async () => {
    const { t, warden } = await setup();
    const resident = await realResident(t);
    const { temporaryPassword } = await warden.as.action(api.residents.resetPassword, {
      residentId: resident.residentId,
    });
    await signIn(t, "signIn", "9876543210", temporaryPassword);
    const session = await t.run(async (ctx) =>
      (await ctx.db.query("authSessions").collect()).find((s) => s.userId === resident.userId)!,
    );
    const as = t.withIdentity({ subject: `${resident.userId}|${session._id}` });
    expect((await as.query(api.users.me, {}))?.profile?.mustChangePassword).toBe(true);
    await as.action(api.users.changePassword, { newPassword: "fresh-tea-91" });
    expect((await as.query(api.users.me, {}))?.profile?.mustChangePassword).toBe(false);
    expect((await signIn(t, "signIn", "9876543210", "fresh-tea-91")).tokens?.token).toBeTruthy();
  });

  test("signed-out visitors can't call it", async () => {
    const { t } = await setup();
    expect(await errorCode(t.action(api.users.changePassword, { newPassword: "fresh-tea-91" }))).toBe("NOT_SIGNED_IN");
  });
});

describe("editing a resident's name or room", () => {
  test("the Warden corrects them; the resident sees it; past choices keep the old details; audited", async () => {
    const { t, warden } = await setup();
    const resident = await createActiveResident(t, "Asha Rao", "204");
    const dinner = await t.run(async (ctx) =>
      (await ctx.db.query("mealServices").collect()).find((s) => s.serviceDate === "2026-10-25" && s.mealType === "dinner")!,
    );
    await resident.as.mutation(api.meals.saveChoices, { choices: [{ mealServiceId: dinner._id, selection: "yes" }] });

    await warden.as.mutation(api.residents.updateDetails, {
      residentId: resident.residentId,
      displayName: "  Asha Rao Sharma ",
      roomNumber: "305",
    });
    const me = await resident.as.query(api.users.me, {});
    expect(me?.profile?.displayName).toBe("Asha Rao Sharma");
    expect(me?.resident?.roomNumber).toBe("305");
    const log = await t.run((ctx) => ctx.db.query("mealActivityLog").collect());
    expect(log[0]).toMatchObject({ residentName: "Asha Rao", roomNumber: "204" });
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.at(-1)).toMatchObject({ action: "resident.details_updated" });

    const edit = (as: typeof warden.as, displayName: string, roomNumber: string) =>
      errorCode(as.mutation(api.residents.updateDetails, { residentId: resident.residentId, displayName, roomNumber }));
    expect(await edit(warden.as, "A", "305")).toBe("INVALID_INPUT");
    expect(await edit(warden.as, "Asha Rao", "")).toBe("INVALID_INPUT");
    expect(await edit(resident.as, "Asha Rao", "999")).toBe("FORBIDDEN");
    const pending = await createSignedUp(t, "Pending Person", "101");
    expect(
      await errorCode(
        warden.as.mutation(api.residents.updateDetails, { residentId: pending.residentId, displayName: "Pending Person", roomNumber: "102" }),
      ),
    ).toBe("CONFLICT");
  });
});
