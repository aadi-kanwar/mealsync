import { v } from "convex/values";
import { internalQuery, requireProfile, requireRole, requireUser } from "./lib/functions";
import { vStaffRole } from "./lib/validators";

/**
 * Permission checks for actions (see signedInAction / staffAction in
 * lib/functions.ts). Internal: never callable from a browser. They run with
 * the caller's own login, so the identity always comes from the session.
 */

export const viewerForAction = internalQuery({
  args: {},
  returns: v.object({ userId: v.id("users"), phone: v.string(), mustChangePassword: v.boolean() }),
  handler: async (ctx) => {
    const { userId, authUser } = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", userId))
      .unique();
    return {
      userId,
      phone: authUser.phone ?? "",
      mustChangePassword: profile?.mustChangePassword === true,
    };
  },
});

export const staffForAction = internalQuery({
  args: { roles: v.array(vStaffRole) },
  returns: v.object({
    userId: v.id("users"),
    propertyId: v.id("properties"),
    displayName: v.string(),
    roles: v.array(vStaffRole),
  }),
  handler: async (ctx, args) => {
    await requireProfile(ctx);
    const staff = await requireRole(ctx, args.roles);
    return {
      userId: staff.userId,
      propertyId: staff.property._id,
      displayName: staff.profile.displayName,
      roles: staff.roles,
    };
  },
});
