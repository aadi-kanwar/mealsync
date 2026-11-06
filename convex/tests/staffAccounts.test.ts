import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { addProperty, createActiveResident, createProperty, createStaff, errorCode, setupTest, type T } from "./harness.test-utils";

function signIn(t: T, phone: string, password: string) {
  return t.action(api.auth.signIn, { provider: "phone-password", params: { flow: "signIn", phone, password } });
}

/** A client acting as `userId` through their latest login (as a phone would after signing in). */
async function asSignedIn(t: T, userId: Id<"users">) {
  const sessions = await t.run(async (ctx) => (await ctx.db.query("authSessions").collect()).filter((s) => s.userId === userId));
  return t.withIdentity({ subject: `${userId}|${sessions.at(-1)!._id}` });
}

async function setup() {
  const t = await setupTest();
  const first = await createProperty(t);
  const second = await addProperty(t, "Second PG");
  const admin = await createStaff(t, "admin", "Ravi Owner");
  return { t, first, second, admin };
}

describe("the Admin creates staff accounts", () => {
  test("a new Warden gets a temporary password, signs in with it and must choose their own", async () => {
    const { t, second, admin } = await setup();
    const { temporaryPassword } = await admin.as.action(api.staff.createAccount, {
      displayName: "Meena Warden",
      phone: "98111 22233",
      role: "warden",
      propertyIds: [second._id],
    });
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);

    const staff = await admin.as.query(api.staff.list, {});
    const meena = staff.find((s) => s.displayName === "Meena Warden")!;
    expect(meena).toMatchObject({ role: "warden", propertyIds: [second._id], phone: "+919811122233", mustChangePassword: true });

    // Their first sign-in: the temporary password works, and they must choose a new one.
    expect((await signIn(t, "9811122233", temporaryPassword)).tokens?.token).toBeTruthy();
    const warden = await asSignedIn(t, meena.userId);
    expect(await warden.query(api.users.me, {})).toMatchObject({
      profile: { displayName: "Meena Warden", mustChangePassword: true },
      staffRoles: ["warden"],
      staff: { properties: [{ name: "Second PG" }] },
    });
    // No need to type the temporary password again.
    await warden.action(api.users.changePassword, { newPassword: "warden-own-pass-1" });
    expect((await warden.query(api.users.me, {}))?.profile?.mustChangePassword).toBe(false);
    expect(await errorCode(signIn(t, "9811122233", temporaryPassword))).toBe("SIGN_IN_FAILED");
    expect((await signIn(t, "9811122233", "warden-own-pass-1")).tokens?.token).toBeTruthy();

    const actions = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["staff.account_created", "staff.role_granted"]));
    // The password itself is never stored or logged.
    const everything = JSON.stringify(await t.run((ctx) => ctx.db.query("auditLogs").collect()));
    expect(everything).not.toContain(temporaryPassword);
  });

  test("an Admin can be created too; bad details, taken numbers and non-Admins are refused, leaving no account", async () => {
    const { t, first, admin } = await setup();
    await admin.as.action(api.staff.createAccount, { displayName: "Second Admin", phone: "9811100009", role: "admin" });
    expect((await admin.as.query(api.staff.list, {})).find((s) => s.displayName === "Second Admin")?.role).toBe("admin");

    const resident = await createActiveResident(t, "Asha Rao", "1");
    const create = (args: { displayName: string; phone: string; role: "warden" | "admin"; propertyIds?: Id<"properties">[] }) =>
      errorCode(admin.as.action(api.staff.createAccount, args));
    const users = async () => (await t.run((ctx) => ctx.db.query("users").collect())).length;
    const before = await users();
    expect(await create({ displayName: "Taken Number", phone: resident.phone, role: "warden", propertyIds: [first._id] })).toBe(
      "CONFLICT",
    );
    expect(await create({ displayName: "No Property", phone: "9811100010", role: "warden", propertyIds: [] })).toBe(
      "INVALID_INPUT",
    );
    expect(await create({ displayName: "A", phone: "9811100011", role: "warden", propertyIds: [first._id] })).toBe(
      "INVALID_INPUT",
    );
    expect(await create({ displayName: "Bad Number", phone: "12", role: "warden", propertyIds: [first._id] })).toBe(
      "INVALID_PHONE",
    );
    expect(await users()).toBe(before);

    const warden = await createStaff(t, "warden");
    expect(
      await errorCode(
        warden.as.action(api.staff.createAccount, {
          displayName: "Sneaky Admin",
          phone: "9811100012",
          role: "admin",
        }),
      ),
    ).toBe("FORBIDDEN");
  });
});

describe("the Admin resets staff passwords", () => {
  test("a Warden who forgot theirs gets a temporary one; their phones are signed out; they choose a new one", async () => {
    const { t, first, admin } = await setup();
    await admin.as.action(api.staff.createAccount, {
      displayName: "Meena Warden",
      phone: "9811122233",
      role: "warden",
      propertyIds: [first._id],
    });
    const meena = (await admin.as.query(api.staff.list, {})).find((s) => s.displayName === "Meena Warden")!;
    await t.run(async (ctx) => {
      const profile = (await ctx.db.query("userProfiles").collect()).find((p) => p.authUserId === meena.userId)!;
      await ctx.db.patch(profile._id, { mustChangePassword: false });
    });
    await signIn(t, "9811122233", "x").catch(() => {});

    const { temporaryPassword } = await admin.as.action(api.staff.resetPassword, { userId: meena.userId });
    const sessions = await t.run(async (ctx) =>
      (await ctx.db.query("authSessions").collect()).filter((s) => s.userId === meena.userId),
    );
    expect(sessions).toEqual([]);
    expect((await signIn(t, "9811122233", temporaryPassword)).tokens?.token).toBeTruthy();
    const warden = await asSignedIn(t, meena.userId);
    expect((await warden.query(api.users.me, {}))?.profile?.mustChangePassword).toBe(true);
    expect((await admin.as.query(api.staff.list, {})).find((s) => s.userId === meena.userId)?.mustChangePassword).toBe(true);
    const actions = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(actions).toContain("staff.password_reset");
  });

  test("not your own, not another organisation's staff, not residents, and never by a Warden", async () => {
    const { t, admin } = await setup();
    expect(await errorCode(admin.as.action(api.staff.resetPassword, { userId: admin.userId }))).toBe("INVALID_INPUT");
    const resident = await createActiveResident(t, "Asha Rao", "1");
    expect(await errorCode(admin.as.action(api.staff.resetPassword, { userId: resident.userId }))).toBe("NOT_FOUND");
    const outsider = await t.run(async (ctx) => {
      const { createOrganization } = await import("../lib/property");
      const org = await createOrganization(ctx, { name: "Other Org", createdBy: undefined });
      const userId = await ctx.db.insert("users", { phone: "+919800000099" });
      await ctx.db.insert("staffRoles", { organizationId: org._id, userId, role: "admin", status: "active", grantedAt: 0 });
      return userId;
    });
    expect(await errorCode(admin.as.action(api.staff.resetPassword, { userId: outsider }))).toBe("NOT_FOUND");
    const warden = await createStaff(t, "warden");
    expect(await errorCode(warden.as.action(api.staff.resetPassword, { userId: admin.userId }))).toBe("FORBIDDEN");
  });
});

describe("changing a staff member's role", () => {
  test("a Warden becomes an Admin (every PG), and back to a Warden of chosen PGs; there's always an Admin", async () => {
    const { t, first, second, admin } = await setup();
    const meena = await createStaff(t, "warden", "Meena Warden", [first._id]);

    await admin.as.mutation(api.staff.changeRole, { userId: meena.userId, role: "admin" });
    let row = (await admin.as.query(api.staff.list, {})).find((s) => s.userId === meena.userId)!;
    expect(row).toMatchObject({ role: "admin", propertyIds: [] });
    expect((await meena.as.query(api.users.me, {}))?.staff).toMatchObject({
      isAdmin: true,
      properties: [{ name: "Second PG" }, { name: "Test PG" }],
    });
    expect(await errorCode(admin.as.mutation(api.staff.changeRole, { userId: meena.userId, role: "admin" }))).toBe("CONFLICT");

    await admin.as.mutation(api.staff.changeRole, { userId: meena.userId, role: "warden", propertyIds: [second._id] });
    row = (await admin.as.query(api.staff.list, {})).find((s) => s.userId === meena.userId)!;
    expect(row).toMatchObject({ role: "warden", propertyIds: [second._id] });
    expect((await meena.as.query(api.users.me, {}))?.staffRoles).toEqual(["warden"]);

    // The only Admin can't become a Warden; a Warden needs a PG.
    expect(
      await errorCode(admin.as.mutation(api.staff.changeRole, { userId: admin.userId, role: "warden", propertyIds: [first._id] })),
    ).toBe("CONFLICT");
    await admin.as.mutation(api.staff.changeRole, { userId: meena.userId, role: "admin" });
    expect(await errorCode(admin.as.mutation(api.staff.changeRole, { userId: meena.userId, role: "warden", propertyIds: [] }))).toBe(
      "INVALID_INPUT",
    );
    const actions = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(actions).toContain("staff.role_changed");

    const resident = await createActiveResident(t, "Asha Rao", "1");
    expect(await errorCode(admin.as.mutation(api.staff.changeRole, { userId: resident.userId, role: "admin" }))).toBe("NOT_FOUND");
    const warden = await createStaff(t, "warden");
    expect(await errorCode(warden.as.mutation(api.staff.changeRole, { userId: warden.userId, role: "admin" }))).toBe("FORBIDDEN");
  });
});
