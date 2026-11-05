import {
  createAccount as createLogin,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  getProfile,
  getStaffAccess,
  internalMutation,
  internalQuery,
  organizationProperties,
  staffAction,
  staffMutation,
  staffQuery,
} from "./lib/functions";
import { displayNameSchema, normalizePhone } from "./lib/inputRules";
import { temporaryPassword } from "./lib/passwords";
import { grantStaffRole, setWardenProperties } from "./lib/staffRoles";
import { vStaffRole } from "./lib/validators";

/** The organisation's staff: one entry per person, with the properties a Warden looks after. Admin only. */
export const list = staffQuery({
  roles: ["admin"],
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("staffRoles")
      .withIndex("by_org_status", (q) => q.eq("organizationId", ctx.staff.organization._id).eq("status", "active"))
      .collect();
    const people = new Map<Id<"users">, { role: "admin" | "warden"; propertyIds: Id<"properties">[]; since: number }>();
    for (const row of rows) {
      const entry = people.get(row.userId) ?? { role: row.role, propertyIds: [], since: row.grantedAt };
      if (row.role === "admin") entry.role = "admin";
      else if (row.propertyId !== undefined) entry.propertyIds.push(row.propertyId);
      entry.since = Math.min(entry.since, row.grantedAt);
      people.set(row.userId, entry);
    }
    const active = new Set(ctx.staff.properties.map((p) => p._id));
    const list = await Promise.all(
      [...people].map(async ([userId, entry]) => {
        const profile = await ctx.db
          .query("userProfiles")
          .withIndex("by_authUserId", (q) => q.eq("authUserId", userId))
          .unique();
        return {
          userId,
          role: entry.role,
          propertyIds: entry.role === "admin" ? [] : entry.propertyIds.filter((id) => active.has(id)),
          displayName: profile?.displayName ?? "(no profile)",
          phone: profile?.phone ?? null,
          // Still on a temporary password (new account, or just reset).
          mustChangePassword: profile?.mustChangePassword === true,
          since: entry.since,
          isMe: userId === ctx.staff.userId,
        };
      }),
    );
    return list.sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName) : a.role === "admin" ? -1 : 1));
  },
});

async function findSignedUp(ctx: { db: import("./_generated/server").QueryCtx["db"] }, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  if (phone === null) throw appError("INVALID_PHONE");
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .unique();
  if (profile === null) {
    throw appError("NOT_FOUND", "No one with that number has finished signing up yet. Ask them to create an account first.");
  }
  return profile;
}

/**
 * Makes someone who has already signed up an Admin (every property) or a
 * Warden of `propertyIds`. Admin only.
 */
export const grantRole = staffMutation({
  roles: ["admin"],
  args: { phone: v.string(), role: vStaffRole, propertyIds: v.optional(v.array(v.id("properties"))) },
  handler: async (ctx, args) => {
    const profile = await findSignedUp(ctx, args.phone);
    await grantStaffRole(ctx, {
      organizationId: ctx.staff.organization._id,
      targetUserId: profile.authUserId,
      role: args.role,
      propertyIds: args.role === "warden" ? (args.propertyIds ?? []) : undefined,
      grantedBy: ctx.staff.userId,
      auditAction: "staff.role_granted",
    });
    return null;
  },
});

/** Changes which properties a Warden looks after. Admin only. */
export const setProperties = staffMutation({
  roles: ["admin"],
  args: { userId: v.id("users"), propertyIds: v.array(v.id("properties")) },
  handler: async (ctx, args) => {
    await setWardenProperties(ctx, {
      organizationId: ctx.staff.organization._id,
      targetUserId: args.userId,
      propertyIds: args.propertyIds,
      actorUserId: ctx.staff.userId,
    });
    return null;
  },
});

/** Removes someone from the staff. Admin only. There must always be at least one Admin left. */
export const remove = staffMutation({
  roles: ["admin"],
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { organization, userId } = ctx.staff;
    const rows = await ctx.db
      .query("staffRoles")
      .withIndex("by_org_status", (q) => q.eq("organizationId", organization._id).eq("status", "active"))
      .collect();
    const theirs = rows.filter((r) => r.userId === args.userId);
    if (theirs.length === 0) throw appError("NOT_FOUND");
    if (theirs.some((r) => r.role === "admin")) {
      const admins = new Set(rows.filter((r) => r.role === "admin").map((r) => r.userId));
      if (admins.size <= 1) throw appError("CONFLICT", "There must always be at least one Admin.");
    }
    const now = Date.now();
    for (const row of theirs) await ctx.db.patch(row._id, { status: "inactive", revokedBy: userId, revokedAt: now });
    await writeAudit(ctx, {
      property: { organizationId: organization._id },
      actorUserId: userId,
      action: "staff.role_revoked",
      entityType: "users",
      entityId: args.userId,
      metadata: { roles: [...new Set(theirs.map((r) => r.role))] },
    });
    return null;
  },
});

/**
 * Creates a login for a new Admin or Warden, with a temporary password
 * shown once to the Admin to pass on. When they sign in with it they must
 * choose their own. For a number with no Dine account yet (someone who
 * already signed up is added with `grantRole`). Admin only; audited.
 */
export const createAccount = staffAction({
  roles: ["admin"],
  args: {
    displayName: v.string(),
    phone: v.string(),
    role: vStaffRole,
    propertyIds: v.optional(v.array(v.id("properties"))),
  },
  handler: async (ctx, args): Promise<{ temporaryPassword: string }> => {
    const name = displayNameSchema.safeParse(args.displayName);
    if (!name.success) throw appError("INVALID_INPUT", name.error.issues[0]?.message);
    const phone = normalizePhone(args.phone);
    if (phone === null) throw appError("INVALID_PHONE");
    const propertyIds = args.role === "warden" ? (args.propertyIds ?? []) : undefined;
    // Everything is checked before the login exists, so a refusal leaves nothing half-made.
    await ctx.runQuery(internal.staff.checkNewStaff, {
      organizationId: ctx.staff.organizationId,
      phone,
      propertyIds,
    });
    // A login without a finished profile also counts as taken.
    let exists = true;
    try {
      await retrieveAccount(ctx, { provider: PHONE_PASSWORD_PROVIDER, account: { id: phone } });
    } catch (error) {
      if (!(error instanceof Error && error.message === "InvalidAccountId")) throw error;
      exists = false;
    }
    if (exists) throw appError("CONFLICT", NUMBER_TAKEN);
    const password = temporaryPassword();
    const { user } = await createLogin(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: password },
      profile: { phone },
    });
    await ctx.runMutation(internal.staff.finishNewStaff, {
      organizationId: ctx.staff.organizationId,
      userId: user._id,
      phone,
      displayName: name.data,
      role: args.role,
      propertyIds,
      actorUserId: ctx.staff.userId,
    });
    return { temporaryPassword: password };
  },
});
const NUMBER_TAKEN =
  "That number already has a Dine account. Add them with “Add someone who has an account” instead.";

export const checkNewStaff = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    phone: v.string(),
    propertyIds: v.optional(v.array(v.id("properties"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const taken = await ctx.db
      .query("userProfiles")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
    if (taken !== null) throw appError("CONFLICT", NUMBER_TAKEN);
    if (args.propertyIds !== undefined) {
      if (args.propertyIds.length === 0) throw appError("INVALID_INPUT", "Choose at least one property.");
      const own = new Set((await organizationProperties(ctx, args.organizationId)).map((p) => p._id));
      if (args.propertyIds.some((id) => !own.has(id))) throw appError("NOT_FOUND", "That property wasn't found.");
    }
    return null;
  },
});

export const finishNewStaff = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    phone: v.string(),
    displayName: v.string(),
    role: vStaffRole,
    propertyIds: v.optional(v.array(v.id("properties"))),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("userProfiles", {
      authUserId: args.userId,
      displayName: args.displayName,
      phone: args.phone,
      status: "active",
      createdAt: Date.now(),
      mustChangePassword: true,
    });
    await grantStaffRole(ctx, {
      organizationId: args.organizationId,
      targetUserId: args.userId,
      role: args.role,
      propertyIds: args.propertyIds,
      grantedBy: args.actorUserId,
      auditAction: "staff.role_granted",
    });
    await writeAudit(ctx, {
      property: { organizationId: args.organizationId },
      actorUserId: args.actorUserId,
      action: "staff.account_created",
      entityType: "users",
      entityId: args.userId,
      metadata: { role: args.role },
    });
    return null;
  },
});

/**
 * Gives a staff member (Admin or Warden) of the organisation who forgot
 * their password a temporary one, shown once to the Admin. Their devices are
 * signed out and they choose a new password when they next sign in. Not for
 * your own account (use Change password). Admin only; audited.
 */
export const resetPassword = staffAction({
  roles: ["admin"],
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ temporaryPassword: string }> => {
    const target = await ctx.runQuery(internal.staff.staffResetTarget, {
      organizationId: ctx.staff.organizationId,
      actorUserId: ctx.staff.userId,
      userId: args.userId,
    });
    const password = temporaryPassword();
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: target.phone, secret: password },
    });
    await invalidateSessions(ctx, { userId: args.userId });
    await ctx.runMutation(internal.staff.recordStaffReset, {
      organizationId: ctx.staff.organizationId,
      userId: args.userId,
      actorUserId: ctx.staff.userId,
    });
    return { temporaryPassword: password };
  },
});

export const staffResetTarget = internalQuery({
  args: { organizationId: v.id("organizations"), actorUserId: v.id("users"), userId: v.id("users") },
  returns: v.object({ phone: v.string() }),
  handler: async (ctx, args) => {
    if (args.userId === args.actorUserId) {
      throw appError("INVALID_INPUT", "To change your own password, use Change password.");
    }
    const access = await getStaffAccess(ctx, args.userId);
    if (access === null || access.organization._id !== args.organizationId) throw appError("NOT_FOUND");
    const user = await ctx.db.get(args.userId);
    if (!user?.phone) throw appError("NOT_FOUND");
    return { phone: user.phone };
  },
});

export const recordStaffReset = internalMutation({
  args: { organizationId: v.id("organizations"), userId: v.id("users"), actorUserId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx, args.userId);
    if (profile !== null) await ctx.db.patch(profile._id, { mustChangePassword: true });
    await writeAudit(ctx, {
      property: { organizationId: args.organizationId },
      actorUserId: args.actorUserId,
      action: "staff.password_reset",
      entityType: "users",
      entityId: args.userId,
    });
    return null;
  },
});
