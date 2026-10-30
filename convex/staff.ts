import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";
import { normalizePhone } from "./lib/inputRules";
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
