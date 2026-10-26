import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";
import { normalizePhone } from "./lib/inputRules";
import { grantStaffRole } from "./lib/staffRoles";
import { vStaffRole } from "./lib/validators";

/** Active staff and their roles. Admin only. */
export const list = staffQuery({
  roles: ["admin"],
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("staffRoles")
      .withIndex("by_property_status", (q) =>
        q.eq("propertyId", ctx.staff.property._id).eq("status", "active"),
      )
      .collect();
    return await Promise.all(
      rows.map(async (row) => {
        const profile = await ctx.db
          .query("userProfiles")
          .withIndex("by_authUserId", (q) => q.eq("authUserId", row.userId))
          .unique();
        return {
          staffRoleId: row._id,
          role: row.role,
          displayName: profile?.displayName ?? "(no profile)",
          phone: profile?.phone ?? null,
          grantedAt: row.grantedAt,
          isMe: row.userId === ctx.staff.userId,
        };
      }),
    );
  },
});

/** Give a staff role to someone who has already signed up. Admin only. */
export const grantRole = staffMutation({
  roles: ["admin"],
  args: { phone: v.string(), role: vStaffRole },
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.phone);
    if (phone === null) throw appError("INVALID_PHONE");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
    if (profile === null) {
      throw appError(
        "NOT_FOUND",
        "No one with that number has finished signing up yet. Ask them to create an account first.",
      );
    }
    await grantStaffRole(ctx, {
      property: ctx.staff.property,
      targetUserId: profile.authUserId,
      role: args.role,
      grantedBy: ctx.staff.userId,
      auditAction: "staff.role_granted",
    });
    return null;
  },
});

/** Remove a staff role. Admin only. There must always be at least one Admin left. */
export const revokeRole = staffMutation({
  roles: ["admin"],
  args: { staffRoleId: v.id("staffRoles") },
  handler: async (ctx, args) => {
    const { property, userId } = ctx.staff;
    const row = await ctx.db.get(args.staffRoleId);
    if (row === null || row.propertyId !== property._id || row.status !== "active") {
      throw appError("NOT_FOUND");
    }
    if (row.role === "admin") {
      const admins = await ctx.db
        .query("staffRoles")
        .withIndex("by_property_role_status", (q) =>
          q.eq("propertyId", property._id).eq("role", "admin").eq("status", "active"),
        )
        .collect();
      if (admins.length <= 1) {
        throw appError("CONFLICT", "There must always be at least one Admin.");
      }
    }
    await ctx.db.patch(row._id, { status: "inactive", revokedBy: userId, revokedAt: Date.now() });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "staff.role_revoked",
      entityType: "staffRoles",
      entityId: row._id,
      metadata: { role: row.role, targetUserId: row.userId },
    });
    return null;
  },
});
