import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";

function checkName(value: string, what: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw appError("INVALID_INPUT", `${what} must be 2 to 80 characters.`);
  return name;
}

/** The organisation and PG details. Admin only. */
export const get = staffQuery({
  roles: [],
  args: {},
  handler: async (ctx) => {
    const { property } = ctx.staff;
    const organization = await ctx.db.get(property.organizationId);
    return { organizationName: organization?.name ?? "", propertyName: property.name, timezone: property.timezone };
  },
});

/** Renames the organisation and/or the PG. Admin only; audited. */
export const update = staffMutation({
  roles: [],
  args: { organizationName: v.string(), propertyName: v.string() },
  handler: async (ctx, args) => {
    const organizationName = checkName(args.organizationName, "The organisation name");
    const propertyName = checkName(args.propertyName, "The PG name");
    const { property, userId } = ctx.staff;
    const organization = await ctx.db.get(property.organizationId);
    if (organization === null) throw appError("NOT_FOUND");
    await ctx.db.patch(organization._id, { name: organizationName });
    await ctx.db.patch(property._id, { name: propertyName });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "settings.updated",
      entityType: "properties",
      entityId: property._id,
      metadata: {
        before: { organizationName: organization.name, propertyName: property.name },
        after: { organizationName, propertyName },
      },
    });
    return null;
  },
});
