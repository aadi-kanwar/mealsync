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
import { getProfile, getResidentRecord, internalAction, internalMutation } from "./lib/functions";
import { passwordProblem } from "./lib/inputRules";
import { ensureProperty } from "./lib/property";
import { grantStaffRole } from "./lib/staffRoles";
import { localDateString } from "./lib/time";

const vKind = v.union(
  v.literal("admin"),
  v.literal("warden"),
  v.literal("kitchen"),
  v.literal("resident_active"),
  v.literal("resident_pending"),
);

export const TEST_USERS = [
  { phone: "+919000000001", displayName: "TEST Admin", roomNumber: "OFFICE", kind: "admin" },
  { phone: "+919000000002", displayName: "TEST Warden", roomNumber: "OFFICE", kind: "warden" },
  { phone: "+919000000003", displayName: "TEST Kitchen", roomNumber: "KITCHEN", kind: "kitchen" },
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

export const ensureDevProperty = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!devSeedAllowed(process.env).allowed) throw new Error("Refusing to seed.");
    await ensureProperty(ctx, {
      organizationName: "TEST Organization",
      propertyName: "TEST PG (development)",
    });
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

    if (args.kind === "admin" || args.kind === "warden" || args.kind === "kitchen") {
      const roles = await ctx.db
        .query("staffRoles")
        .withIndex("by_property_user", (q) =>
          q.eq("propertyId", property._id).eq("userId", args.userId),
        )
        .collect();
      if (!roles.some((r) => r.role === args.kind && r.status === "active")) {
        await grantStaffRole(ctx, {
          property,
          targetUserId: args.userId,
          role: args.kind,
          grantedBy: undefined,
          auditAction: "staff.role_granted",
        });
      }
      return null;
    }

    if ((await getResidentRecord(ctx, property._id, args.userId)) === null) {
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
