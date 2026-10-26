/**
 * One-time setup steps. These are INTERNAL functions: browsers can never call
 * them. The owner runs them from the Convex dashboard (Functions -> setup ->
 * Run function), as described in README.md.
 */
import { v } from "convex/values";
import { appError } from "./lib/errors";
import { getCurrentProperty, internalMutation } from "./lib/functions";
import { normalizePhone } from "./lib/inputRules";
import { ensureProperty } from "./lib/property";
import { grantStaffRole } from "./lib/staffRoles";

/** Step 1: create the PG. Running it again does nothing. */
export const createProperty = internalMutation({
  args: {
    organizationName: v.string(),
    propertyName: v.string(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { property, created } = await ensureProperty(ctx, args);
    return {
      created,
      propertyName: property.name,
      message: created ? "PG created." : "A PG already exists, so nothing was changed.",
    };
  },
});

/**
 * Step 2: make the owner the first Admin. The owner must first sign up in
 * the app and fill in their name and room. Refuses to run once any Admin
 * exists, so it can't be used to take over the app later.
 */
export const makeFirstAdmin = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const property = await getCurrentProperty(ctx);
    const existingAdmin = await ctx.db
      .query("staffRoles")
      .withIndex("by_property_role_status", (q) =>
        q.eq("propertyId", property._id).eq("role", "admin").eq("status", "active"),
      )
      .first();
    if (existingAdmin !== null) {
      throw appError(
        "CONFLICT",
        "An Admin already exists. Further staff must be added by an Admin inside the app.",
      );
    }
    const phone = normalizePhone(args.phone);
    if (phone === null) throw appError("INVALID_PHONE");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
    if (profile === null) {
      throw appError(
        "NOT_FOUND",
        "No account with that number has finished signing up. Sign up in the app first.",
      );
    }
    await grantStaffRole(ctx, {
      property,
      targetUserId: profile.authUserId,
      role: "admin",
      grantedBy: undefined,
      auditAction: "setup.first_admin_created",
    });
    return { message: `${profile.displayName} is now the Admin.` };
  },
});
