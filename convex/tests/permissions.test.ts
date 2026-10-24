import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { requireActiveResident, requireRole } from "../lib/functions";
import {
  createActiveResident,
  createLogin,
  createProperty,
  createSignedUp,
  createStaff,
  errorCode,
  setupTest,
} from "./harness.test-utils";

async function setup() {
  const t = await setupTest();
  const property = await createProperty(t);
  return { t, property };
}

describe("signed-out visitors", () => {
  test("see nothing and can change nothing", async () => {
    const { t } = await setup();
    expect(await t.query(api.users.me, {})).toBeNull();
    expect(
      await errorCode(t.mutation(api.users.completeProfile, { displayName: "X Y", roomNumber: "1" })),
    ).toBe("NOT_SIGNED_IN");
    expect(await errorCode(t.query(api.residents.listPending, {}))).toBe("NOT_SIGNED_IN");
    expect(await errorCode(t.query(api.staff.list, {}))).toBe("NOT_SIGNED_IN");
  });
});

describe("completing a profile (open sign-up)", () => {
  test("creates a PENDING resident using the phone from the login, and is audited", async () => {
    const { t } = await setup();
    const login = await createLogin(t, "+919811112222");
    await login.as.mutation(api.users.completeProfile, {
      displayName: "  Asha Rao ",
      roomNumber: "204",
    });
    const me = await login.as.query(api.users.me, {});
    expect(me).toMatchObject({
      phone: "+919811112222",
      profile: { displayName: "Asha Rao", status: "active" },
      staffRoles: [],
      resident: { status: "pending", roomNumber: "204", validFrom: null },
    });
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.map((a) => a.action)).toContain("resident.signed_up");
  });

  test("can't be done twice and rejects bad input", async () => {
    const { t } = await setup();
    const login = await createLogin(t);
    expect(
      await errorCode(login.as.mutation(api.users.completeProfile, { displayName: "A", roomNumber: "1" })),
    ).toBe("INVALID_INPUT");
    expect(
      await errorCode(
        login.as.mutation(api.users.completeProfile, { displayName: "Asha", roomNumber: "<script>" }),
      ),
    ).toBe("INVALID_INPUT");
    await login.as.mutation(api.users.completeProfile, { displayName: "Asha", roomNumber: "1" });
    expect(
      await errorCode(login.as.mutation(api.users.completeProfile, { displayName: "Asha", roomNumber: "2" })),
    ).toBe("PROFILE_EXISTS");
  });

  test("fails clearly when the PG hasn't been set up", async () => {
    const t = await setupTest();
    const login = await createLogin(t);
    expect(
      await errorCode(login.as.mutation(api.users.completeProfile, { displayName: "Asha", roomNumber: "1" })),
    ).toBe("NOT_SET_UP");
  });

  test("`me` only ever describes the caller", async () => {
    const { t } = await setup();
    const a = await createSignedUp(t, "Person A", "1");
    const b = await createSignedUp(t, "Person B", "2");
    expect((await a.as.query(api.users.me, {}))?.profile?.displayName).toBe("Person A");
    expect((await b.as.query(api.users.me, {}))?.profile?.displayName).toBe("Person B");
  });
});

describe("approval before counting", () => {
  test("pending, rejected and inactive residents fail the active-resident check; active passes", async () => {
    const { t } = await setup();
    const pending = await createSignedUp(t, "Pending", "1");
    expect(await errorCode(pending.as.run((ctx) => requireActiveResident(ctx)))).toBe(
      "RESIDENT_NOT_ACTIVE",
    );
    for (const status of ["rejected", "inactive"] as const) {
      const person = await createSignedUp(t, `Person ${status}`, "2");
      await t.run((ctx) => ctx.db.patch(person.residentId, { status }));
      expect(await errorCode(person.as.run((ctx) => requireActiveResident(ctx)))).toBe(
        "RESIDENT_NOT_ACTIVE",
      );
    }
    const active = await createActiveResident(t);
    const viewer = await active.as.run((ctx) => requireActiveResident(ctx));
    expect(viewer.resident.status).toBe("active");
  });

  test("a staff member with no resident record is not a resident", async () => {
    const { t } = await setup();
    const kitchen = await createStaff(t, "kitchen");
    expect(await errorCode(kitchen.as.run((ctx) => requireActiveResident(ctx)))).toBe("FORBIDDEN");
  });

  test("Warden approves with room and start date; approval is audited", async () => {
    const { t } = await setup();
    const warden = await createStaff(t, "warden");
    const person = await createSignedUp(t, "New Person", "10A");

    const pending = await warden.as.query(api.residents.listPending, {});
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ displayName: "New Person", roomNumber: "10A" });
    expect(pending[0].phone).toMatch(/^\+91/);

    await warden.as.mutation(api.residents.approve, {
      residentId: person.residentId,
      roomNumber: "10B",
      validFrom: "2026-11-01",
    });
    const me = await person.as.query(api.users.me, {});
    expect(me?.resident).toMatchObject({ status: "active", roomNumber: "10B", validFrom: "2026-11-01" });
    expect(await warden.as.query(api.residents.listPending, {})).toHaveLength(0);

    const audit = await t.run((ctx) =>
      ctx.db.query("auditLogs").filter((q) => q.eq(q.field("action"), "resident.approved")).collect(),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: warden.userId,
      entityId: person.residentId,
      metadata: { roomNumberRequested: "10A", roomNumberApproved: "10B", validFrom: "2026-11-01" },
    });
  });

  test("approval validates input and can only happen once", async () => {
    const { t } = await setup();
    const warden = await createStaff(t, "warden");
    const person = await createSignedUp(t);
    expect(
      await errorCode(
        warden.as.mutation(api.residents.approve, {
          residentId: person.residentId,
          roomNumber: "1",
          validFrom: "2026-02-30",
        }),
      ),
    ).toBe("INVALID_INPUT");
    await warden.as.mutation(api.residents.approve, {
      residentId: person.residentId,
      roomNumber: "1",
      validFrom: "2026-11-01",
    });
    expect(
      await errorCode(
        warden.as.mutation(api.residents.approve, {
          residentId: person.residentId,
          roomNumber: "1",
          validFrom: "2026-11-01",
        }),
      ),
    ).toBe("CONFLICT");
    expect(await errorCode(warden.as.mutation(api.residents.reject, { residentId: person.residentId }))).toBe(
      "CONFLICT",
    );
  });

  test("Admin can reject; rejection is audited and the person stays not-active", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin");
    const person = await createSignedUp(t);
    await admin.as.mutation(api.residents.reject, { residentId: person.residentId });
    expect((await person.as.query(api.users.me, {}))?.resident?.status).toBe("rejected");
    const actions = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(actions).toContain("resident.rejected");
  });

  test("staff can't act on residents of another property, even with a real ID", async () => {
    const { t, property } = await setup();
    const warden = await createStaff(t, "warden");
    const otherResidentId = await t.run(async (ctx) => {
      const otherProperty = await ctx.db.insert("properties", {
        organizationId: property.organizationId,
        name: "Other PG",
        slug: "other",
        timezone: "Asia/Kolkata",
        status: "inactive",
        reminderSettings: { bannerMinutesBeforeCutoff: 120 },
      });
      const userId = await ctx.db.insert("users", { phone: "+919999999999" });
      return ctx.db.insert("residents", {
        organizationId: property.organizationId,
        propertyId: otherProperty,
        userId,
        displayName: "Elsewhere",
        roomNumber: "1",
        status: "pending",
        createdAt: Date.now(),
      });
    });
    expect(
      await errorCode(
        warden.as.mutation(api.residents.approve, {
          residentId: otherResidentId,
          roomNumber: "1",
          validFrom: "2026-11-01",
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await errorCode(warden.as.mutation(api.residents.reject, { residentId: otherResidentId }))).toBe(
      "NOT_FOUND",
    );
  });
});

describe("role checks", () => {
  test("residents (pending or active) can't call any staff or admin function", async () => {
    const { t } = await setup();
    const target = await createSignedUp(t, "Target", "9");
    for (const person of [await createSignedUp(t), await createActiveResident(t)]) {
      expect(await errorCode(person.as.query(api.residents.listPending, {}))).toBe("FORBIDDEN");
      expect(await errorCode(person.as.query(api.residents.pendingCount, {}))).toBe("FORBIDDEN");
      expect(
        await errorCode(
          person.as.mutation(api.residents.approve, {
            residentId: target.residentId,
            roomNumber: "1",
            validFrom: "2026-11-01",
          }),
        ),
      ).toBe("FORBIDDEN");
      expect(await errorCode(person.as.mutation(api.residents.reject, { residentId: target.residentId }))).toBe(
        "FORBIDDEN",
      );
      expect(await errorCode(person.as.query(api.staff.list, {}))).toBe("FORBIDDEN");
      expect(
        await errorCode(person.as.mutation(api.staff.grantRole, { phone: person.phone, role: "admin" })),
      ).toBe("FORBIDDEN");
    }
    // The target was never touched.
    expect((await target.as.query(api.users.me, {}))?.resident?.status).toBe("pending");
  });

  test("a resident cannot make themselves staff", async () => {
    const { t } = await setup();
    const person = await createActiveResident(t);
    for (const role of ["admin", "warden", "kitchen"] as const) {
      expect(await errorCode(person.as.mutation(api.staff.grantRole, { phone: person.phone, role }))).toBe(
        "FORBIDDEN",
      );
    }
    expect((await person.as.query(api.users.me, {}))?.staffRoles).toEqual([]);
  });

  test("Kitchen sees the waiting count but not the sign-up list with phone numbers", async () => {
    const { t } = await setup();
    const kitchen = await createStaff(t, "kitchen");
    await createSignedUp(t);
    expect(await kitchen.as.query(api.residents.pendingCount, {})).toBe(1);
    expect(await errorCode(kitchen.as.query(api.residents.listPending, {}))).toBe("FORBIDDEN");
    const person = await createSignedUp(t);
    expect(
      await errorCode(
        kitchen.as.mutation(api.residents.approve, {
          residentId: person.residentId,
          roomNumber: "1",
          validFrom: "2026-11-01",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  test("Warden can't manage staff; only Admin can", async () => {
    const { t } = await setup();
    const warden = await createStaff(t, "warden");
    const person = await createSignedUp(t);
    expect(await errorCode(warden.as.query(api.staff.list, {}))).toBe("FORBIDDEN");
    expect(
      await errorCode(warden.as.mutation(api.staff.grantRole, { phone: person.phone, role: "kitchen" })),
    ).toBe("FORBIDDEN");
    expect(
      await errorCode(warden.as.mutation(api.staff.grantRole, { phone: warden.phone, role: "admin" })),
    ).toBe("FORBIDDEN");
  });

  test("Admin passes every role check", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin");
    for (const roles of [["warden"], ["kitchen"], ["admin"]] as const) {
      const viewer = await admin.as.run((ctx) => requireRole(ctx, roles));
      expect(viewer.roles).toEqual(["admin"]);
    }
  });

  test("a revoked role stops working immediately", async () => {
    const { t } = await setup();
    const warden = await createStaff(t, "warden");
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("staffRoles").collect()).find((r) => r.userId === warden.userId)!;
      await ctx.db.patch(row._id, { status: "inactive" });
    });
    expect(await errorCode(warden.as.query(api.residents.listPending, {}))).toBe("FORBIDDEN");
  });

  test("a switched-off account is refused everywhere", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin");
    await t.run(async (ctx) => {
      const profile = (await ctx.db.query("userProfiles").collect()).find(
        (p) => p.authUserId === admin.userId,
      )!;
      await ctx.db.patch(profile._id, { status: "inactive" });
    });
    expect(await errorCode(admin.as.query(api.staff.list, {}))).toBe("ACCOUNT_DISABLED");
  });

  test("a signed-in account without a profile can't reach staff functions", async () => {
    const { t } = await setup();
    const login = await createLogin(t);
    expect(await errorCode(login.as.query(api.residents.listPending, {}))).toBe("PROFILE_REQUIRED");
  });
});

describe("staff management (Admin)", () => {
  test("grant a role to a signed-up person; their pending sign-up is closed; all audited", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin");
    const person = await createSignedUp(t, "Cook", "K");
    await admin.as.mutation(api.staff.grantRole, { phone: person.phone, role: "kitchen" });

    const me = await person.as.query(api.users.me, {});
    expect(me?.staffRoles).toEqual(["kitchen"]);
    expect(me?.resident?.status).toBe("inactive");
    expect(await admin.as.query(api.residents.pendingCount, {})).toBe(0);

    const actions = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["staff.role_granted", "resident.withdrawn_for_staff"]));
    expect(
      await errorCode(admin.as.mutation(api.staff.grantRole, { phone: person.phone, role: "kitchen" })),
    ).toBe("CONFLICT");
  });

  test("an approved resident keeps their resident status when given a staff role", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin");
    const person = await createActiveResident(t);
    await admin.as.mutation(api.staff.grantRole, { phone: person.phone, role: "kitchen" });
    expect((await person.as.query(api.users.me, {}))?.resident?.status).toBe("active");
  });

  test("granting to an unknown or invalid number fails clearly", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin");
    expect(await errorCode(admin.as.mutation(api.staff.grantRole, { phone: "9000011111", role: "warden" }))).toBe(
      "NOT_FOUND",
    );
    expect(await errorCode(admin.as.mutation(api.staff.grantRole, { phone: "12", role: "warden" }))).toBe(
      "INVALID_PHONE",
    );
  });

  test("revoking works and is audited, but the last Admin can't be removed", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin");
    const person = await createSignedUp(t);
    await admin.as.mutation(api.staff.grantRole, { phone: person.phone, role: "warden" });
    const staff = await admin.as.query(api.staff.list, {});
    const wardenRow = staff.find((s) => s.role === "warden")!;
    const adminRow = staff.find((s) => s.role === "admin")!;
    expect(adminRow.isMe).toBe(true);

    await admin.as.mutation(api.staff.revokeRole, { staffRoleId: wardenRow.staffRoleId });
    expect((await person.as.query(api.users.me, {}))?.staffRoles).toEqual([]);
    expect(await errorCode(admin.as.mutation(api.staff.revokeRole, { staffRoleId: adminRow.staffRoleId }))).toBe(
      "CONFLICT",
    );
    const actions = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(actions).toContain("staff.role_revoked");
  });
});
