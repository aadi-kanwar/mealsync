import { v } from "convex/values";
import { internalQuery, organizationProperties, viewerQuery } from "./lib/functions";

/**
 * Organisations and their properties (names only), for the residents'
 * sign-up form. Public: shown before anyone signs in.
 */
export const list = viewerQuery({
  args: {},
  handler: async (ctx) => {
    const organizations = await ctx.db.query("organizations").collect();
    const listed = await Promise.all(
      organizations
        .filter((o) => o.status === "active")
        .map(async (o) => ({
          organizationId: o._id,
          name: o.name,
          properties: (await organizationProperties(ctx, o._id)).map((p) => ({ propertyId: p._id, name: p.name })),
        })),
    );
    return listed.filter((o) => o.properties.length > 0).sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Whether `propertyId` (as sent by a browser) is an active property. Used before creating an account. */
export const propertyIsOpen = internalQuery({
  args: { propertyId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("properties", args.propertyId);
    const property = id && (await ctx.db.get(id));
    if (!property || property.status !== "active") return false;
    const organization = await ctx.db.get(property.organizationId);
    return organization?.status === "active";
  },
});
