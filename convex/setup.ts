/**
 * One-time setup steps. These are INTERNAL functions: browsers can never call
 * them. The owner runs them from the Convex dashboard (Functions -> setup ->
 * Run function), as described in README.md.
 */
import { v } from "convex/values";
import { appError } from "./lib/errors";
import { internalMutation } from "./lib/functions";
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
 * Step 2: make the owner the first Admin of the organisation created in
 * step 1. The owner must first sign up in the app. Refuses to run once that
 * organisation has an Admin, so it can't be used to take over the app later.
 * (Admins who sign up through "Create an organisation" don't need this.)
 */
export const makeFirstAdmin = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .first();
    if (property === null) throw appError("NOT_SET_UP");
    const existingAdmin = (
      await ctx.db
        .query("staffRoles")
        .withIndex("by_org_status", (q) => q.eq("organizationId", property.organizationId).eq("status", "active"))
        .collect()
    ).find((r) => r.role === "admin");
    if (existingAdmin !== undefined) {
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
      organizationId: property.organizationId,
      targetUserId: profile.authUserId,
      role: "admin",
      grantedBy: undefined,
      auditAction: "setup.first_admin_created",
    });
    return { message: `${profile.displayName} is now the Admin.` };
  },
});
