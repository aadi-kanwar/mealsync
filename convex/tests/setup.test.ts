import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { DEFAULT_MEAL_SLOTS } from "../lib/property";
import { createProperty, createSignedUp, errorCode, setupTest } from "./harness.test-utils";

describe("one-time setup", () => {
  test("createProperty makes one org, one PG (Asia/Kolkata) and the default meal slots; rerun changes nothing", async () => {
    const t = await setupTest();
    const first = await t.mutation(internal.setup.createProperty, {
      organizationName: "Sunrise Stays",
      propertyName: "Sunrise PG",
    });
    const second = await t.mutation(internal.setup.createProperty, {
      organizationName: "Other",
      propertyName: "Other PG",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const state = await t.run(async (ctx) => ({
      orgs: await ctx.db.query("organizations").collect(),
      properties: await ctx.db.query("properties").collect(),
      slots: await ctx.db.query("mealSlots").collect(),
    }));
    expect(state.orgs).toHaveLength(1);
    expect(state.properties).toHaveLength(1);
    expect(state.properties[0]).toMatchObject({ name: "Sunrise PG", timezone: "Asia/Kolkata" });
    expect(state.slots.map((s) => s.mealType)).toEqual(DEFAULT_MEAL_SLOTS.map((s) => s.mealType));
    for (const slot of state.slots) {
      expect(slot.propertyId).toBe(state.properties[0]._id);
      expect(slot.organizationId).toBe(state.orgs[0]._id);
    }
  });

  test("makeFirstAdmin needs a finished sign-up, then works exactly once", async () => {
    const t = await setupTest();
    await createProperty(t);
    expect(await errorCode(t.mutation(internal.setup.makeFirstAdmin, { phone: "9876500000" }))).toBe(
      "NOT_FOUND",
    );
    const owner = await createSignedUp(t, "Owner", "OFFICE");
    await t.mutation(internal.setup.makeFirstAdmin, { phone: owner.phone });
    const me = await owner.as.query(api.users.me, {});
    expect(me?.staffRoles).toEqual(["admin"]);
    // Their own pending sign-up doesn't clutter the approvals list.
    expect(me?.resident?.status).toBe("inactive");

    const someoneElse = await createSignedUp(t, "Intruder", "1");
    expect(await errorCode(t.mutation(internal.setup.makeFirstAdmin, { phone: someoneElse.phone }))).toBe(
      "CONFLICT",
    );
    expect((await someoneElse.as.query(api.users.me, {}))?.staffRoles).toEqual([]);
    const actions = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(actions).toContain("setup.first_admin_created");
  });

  test("setup and seed functions can't be called from a browser", async () => {
    const setup = await import("../setup");
    const seed = await import("../seed");
    for (const fn of [setup.createProperty, setup.makeFirstAdmin, seed.dev, seed.ensureDevProperty, seed.attachTestUser]) {
      expect((fn as unknown as { isInternal?: boolean }).isInternal).toBe(true);
      expect((fn as unknown as { isPublic?: boolean }).isPublic).toBeUndefined();
    }
  });
});

describe("development seed", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.MEALSYNC_ALLOW_DEV_SEED = saved.MEALSYNC_ALLOW_DEV_SEED;
    process.env.DEV_SEED_PASSWORD = saved.DEV_SEED_PASSWORD;
  });

  test("refuses to run unless explicitly allowed with a strong password", async () => {
    const t = await setupTest();
    delete process.env.MEALSYNC_ALLOW_DEV_SEED;
    process.env.DEV_SEED_PASSWORD = "a-good-password";
    await expect(t.action(internal.seed.dev, {})).rejects.toThrow(/Refusing to seed/);
    process.env.MEALSYNC_ALLOW_DEV_SEED = "true";
    process.env.DEV_SEED_PASSWORD = "short";
    await expect(t.action(internal.seed.dev, {})).rejects.toThrow(/Refusing to seed/);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
  });

  test("creates clearly labelled TEST accounts that can sign in; rerunning adds no duplicates", async () => {
    const t = await setupTest();
    process.env.MEALSYNC_ALLOW_DEV_SEED = "true";
    process.env.DEV_SEED_PASSWORD = "dev-seed-pass-1";
    await t.action(internal.seed.dev, {});
    await t.action(internal.seed.dev, {});
    const state = await t.run(async (ctx) => ({
      profiles: await ctx.db.query("userProfiles").collect(),
      staff: await ctx.db.query("staffRoles").collect(),
      residents: await ctx.db.query("residents").collect(),
      properties: await ctx.db.query("properties").collect(),
    }));
    expect(state.properties).toHaveLength(1);
    expect(state.properties[0].name).toContain("TEST");
    expect(state.profiles).toHaveLength(5);
    expect(state.profiles.every((p) => p.displayName.startsWith("TEST"))).toBe(true);
    expect(state.staff.map((s) => s.role).sort()).toEqual(["admin", "warden"]);
    expect(state.residents.map((r) => r.status).sort()).toEqual(["active", "active", "pending"]);

    const login = await t.action(api.auth.signIn, {
      provider: "phone-password",
      params: { flow: "signIn", phone: "9000000002", password: "dev-seed-pass-1" },
    });
    expect(login.tokens?.token).toBeTruthy();
  });
});
