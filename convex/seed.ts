/**
 * DEVELOPMENT ONLY test data.
 *
 * Creates one organization, one PG with default meal slots, and clearly
 * labelled TEST accounts. It refuses to run unless the Convex deployment has
 * MEALSYNC_ALLOW_DEV_SEED=true and a DEV_SEED_PASSWORD set. Never set those
 * on the production deployment.
 *
 * Run with:  npx convex run seed:dev
 */
import { createAccount, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { writeAudit } from "./lib/audit";
import {
  getProfile,
  getResidentRecord,
  getStaffAccess,
  internalAction,
  internalMutation,
  organizationProperties,
} from "./lib/functions";
import { passwordProblem } from "./lib/inputRules";
import { createProperty, ensureProperty } from "./lib/property";
import { grantStaffRole } from "./lib/staffRoles";
import { localDateString } from "./lib/time";

const vKind = v.union(
  v.literal("admin"),
  v.literal("warden"),
  v.literal("resident_active"),
  v.literal("resident_pending"),
);

export const TEST_USERS = [
  { phone: "+919000000001", displayName: "TEST Admin", roomNumber: "OFFICE", kind: "admin" },
  { phone: "+919000000002", displayName: "TEST Warden", roomNumber: "OFFICE", kind: "warden" },
  { phone: "+919000000004", displayName: "TEST Resident A", roomNumber: "101", kind: "resident_active" },
  { phone: "+919000000005", displayName: "TEST Resident B", roomNumber: "102", kind: "resident_active" },
  { phone: "+919000000006", displayName: "TEST Pending C", roomNumber: "103", kind: "resident_pending" },
] as const;

export function devSeedAllowed(env: Record<string, string | undefined>): {
  allowed: boolean;
  reason?: string;
} {
  if (env.MEALSYNC_ALLOW_DEV_SEED !== "true") {
    return { allowed: false, reason: "MEALSYNC_ALLOW_DEV_SEED is not 'true' on this deployment." };
  }
  const password = env.DEV_SEED_PASSWORD ?? "";
  if (passwordProblem(password, null) !== null) {
    return { allowed: false, reason: "DEV_SEED_PASSWORD is missing or too weak." };
  }
  return { allowed: true };
}

export const dev = internalAction({
  args: {},
  handler: async (ctx) => {
    const check = devSeedAllowed(process.env);
    if (!check.allowed) throw new Error(`Refusing to seed: ${check.reason}`);
    const password = process.env.DEV_SEED_PASSWORD!;

    await ctx.runMutation(internal.seed.ensureDevProperty, {});
    const results: string[] = [];
    for (const user of TEST_USERS) {
      let userId: Id<"users">;
      try {
        const existing = await retrieveAccount(ctx, {
          provider: PHONE_PASSWORD_PROVIDER,
          account: { id: user.phone },
        });
        userId = existing.user._id;
      } catch {
        const created = await createAccount(ctx, {
          provider: PHONE_PASSWORD_PROVIDER,
          account: { id: user.phone, secret: password },
          profile: { phone: user.phone },
        });
        userId = created.user._id;
      }
      await ctx.runMutation(internal.seed.attachTestUser, {
        userId,
        phone: user.phone,
        displayName: user.displayName,
        roomNumber: user.roomNumber,
        kind: user.kind,
      });
      results.push(`${user.displayName}: ${user.phone}`);
    }
    return { accounts: results };
  },
});

const SECOND_PG = "TEST PG 2 (development)";

export const ensureDevProperty = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!devSeedAllowed(process.env).allowed) throw new Error("Refusing to seed.");
    const { property } = await ensureProperty(ctx, {
      organizationName: "TEST Organization",
      propertyName: "TEST PG (development)",
    });
    // A second PG, so screens covering several properties can be tried.
    const others = await organizationProperties(ctx, property.organizationId);
    if (!others.some((p) => p.name === SECOND_PG)) {
      await createProperty(ctx, { organizationId: property.organizationId, name: SECOND_PG, createdBy: undefined });
    }
    return null;
  },
});

export const attachTestUser = internalMutation({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    displayName: v.string(),
    roomNumber: v.string(),
    kind: vKind,
  },
  handler: async (ctx, args) => {
    if (!devSeedAllowed(process.env).allowed) throw new Error("Refusing to seed.");
    const property = (await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .first())!;
    const now = Date.now();

    if ((await getProfile(ctx, args.userId)) === null) {
      await ctx.db.insert("userProfiles", {
        authUserId: args.userId,
        displayName: args.displayName,
        phone: args.phone,
        status: "active",
        createdAt: now,
      });
    }

    if (args.kind === "admin" || args.kind === "warden") {
      // The Warden looks after the first PG only.
      const access = await getStaffAccess(ctx, args.userId);
      if (access === null || !access.roles.includes(args.kind)) {
        await grantStaffRole(ctx, {
          organizationId: property.organizationId,
          targetUserId: args.userId,
          role: args.kind,
          propertyIds: args.kind === "warden" ? [property._id] : undefined,
          grantedBy: undefined,
          auditAction: "staff.role_granted",
        });
      }
      return null;
    }

    if ((await getResidentRecord(ctx, args.userId)) === null) {
      const active = args.kind === "resident_active";
      const residentId = await ctx.db.insert("residents", {
        organizationId: property.organizationId,
        propertyId: property._id,
        userId: args.userId,
        displayName: args.displayName,
        roomNumber: args.roomNumber,
        status: active ? "active" : "pending",
        createdAt: now,
        ...(active
          ? { validFrom: localDateString(now, property.timezone), approvedAt: now }
          : {}),
      });
      await writeAudit(ctx, {
        property,
        actorUserId: undefined,
        action: "dev.seeded",
        entityType: "residents",
        entityId: residentId,
        metadata: { kind: args.kind },
      });
    }
    return null;
  },
});

/**
 * DEVELOPMENT ONLY: removes the accounts the automated browser tests create
 * ("E2E Person ..."), with their logins and meal choices. Refuses to run
 * unless test data is allowed on this deployment (never on production).
 *
 * Run with:  npx convex run seed:removeTestSignups
 */
export const removeTestSignups = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!devSeedAllowed(process.env).allowed) throw new Error("Refusing: test data isn't allowed on this deployment.");
    const profiles = (await ctx.db.query("userProfiles").collect()).filter((p) => p.displayName.startsWith("E2E Person"));
    const userIds = new Set<Id<"users">>(profiles.map((p) => p.authUserId));
    const residents = (await ctx.db.query("residents").collect()).filter((r) => userIds.has(r.userId));
    const residentIds = new Set(residents.map((r) => r._id));
    const sessions = (await ctx.db.query("authSessions").collect()).filter((s) => userIds.has(s.userId));
    const sessionIds = new Set(sessions.map((s) => s._id));
    const rows = [
      ...(await ctx.db.query("mealResponses").collect()).filter((r) => residentIds.has(r.residentId)),
      ...residents,
      ...profiles,
      ...(await ctx.db.query("staffRoles").collect()).filter((r) => userIds.has(r.userId)),
      ...(await ctx.db.query("authRefreshTokens").collect()).filter((t) => sessionIds.has(t.sessionId)),
      ...sessions,
      ...(await ctx.db.query("authAccounts").collect()).filter((a) => userIds.has(a.userId)),
    ];
    for (const row of rows) await ctx.db.delete(row._id);
    // Organisations they created can't be deleted (their audit entries are permanent): close them.
    for (const org of (await ctx.db.query("organizations").collect()).filter((o) => o.createdBy && userIds.has(o.createdBy))) {
      await ctx.db.patch(org._id, { status: "inactive" });
      for (const p of await organizationProperties(ctx, org._id)) await ctx.db.patch(p._id, { status: "inactive" });
    }
    for (const userId of userIds) await ctx.db.delete(userId);
    return { removedAccounts: userIds.size };
  },
});
