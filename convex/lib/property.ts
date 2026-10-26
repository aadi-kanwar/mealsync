import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { writeAudit } from "./audit";
import { appError } from "./errors";
import { DEFAULT_TIMEZONE, isValidTimezone, localDateString } from "./time";
import type { MealType } from "./validators";

/** The PG's meal timings (start and end), used when the property is set up. */
export const DEFAULT_MEAL_SLOTS: ReadonlyArray<{
  mealType: MealType;
  displayName: string;
  serviceTime: string;
  endTime: string;
}> = [
  { mealType: "breakfast", displayName: "Breakfast", serviceTime: "07:30", endTime: "09:30" },
  { mealType: "lunch", displayName: "Lunch", serviceTime: "12:00", endTime: "14:00" },
  { mealType: "snacks", displayName: "Snacks", serviceTime: "17:00", endTime: "18:00" },
  { mealType: "dinner", displayName: "Dinner", serviceTime: "20:00", endTime: "21:30" },
];

/** Every day's meals are decided by 6 AM that same day. */
export const DEFAULT_CUTOFF_RULE = { daysBefore: 0, time: "06:00" };

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "pg";
}

/**
 * Creates the organization, the property and its default meal slots.
 * Safe to run more than once: if a property already exists it is returned
 * unchanged.
 */
export async function ensureProperty(
  ctx: Pick<MutationCtx, "db">,
  args: { organizationName: string; propertyName: string; timezone?: string },
): Promise<{ property: Doc<"properties">; created: boolean }> {
  const existing = await ctx.db
    .query("properties")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .first();
  if (existing !== null) return { property: existing, created: false };

  const organizationName = args.organizationName.trim();
  const propertyName = args.propertyName.trim();
  if (organizationName.length < 2 || propertyName.length < 2) {
    throw appError("INVALID_INPUT", "Organization and PG names must be at least 2 characters.");
  }
  const timezone = args.timezone ?? DEFAULT_TIMEZONE;
  if (!isValidTimezone(timezone)) throw appError("INVALID_INPUT", "Unknown timezone.");

  const orgSlug = slugify(organizationName);
  let organization = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
    .unique();
  if (organization === null) {
    const organizationId = await ctx.db.insert("organizations", {
      name: organizationName,
      slug: orgSlug,
      status: "active",
    });
    organization = (await ctx.db.get(organizationId))!;
  }

  const propertyId = await ctx.db.insert("properties", {
    organizationId: organization._id,
    name: propertyName,
    slug: slugify(propertyName),
    timezone,
    status: "active",
    reminderSettings: { bannerMinutesBeforeCutoff: 120 },
  });
  const property = (await ctx.db.get(propertyId))!;

  const today = localDateString(Date.now(), timezone);
  for (const [index, slot] of DEFAULT_MEAL_SLOTS.entries()) {
    await ctx.db.insert("mealSlots", {
      organizationId: organization._id,
      propertyId,
      mealType: slot.mealType,
      displayName: slot.displayName,
      serviceTime: slot.serviceTime,
      endTime: slot.endTime,
      cutoffRule: DEFAULT_CUTOFF_RULE,
      serviceDays: [0, 1, 2, 3, 4, 5, 6],
      sortOrder: index,
      active: true,
      effectiveFrom: today,
    });
  }
  await writeAudit(ctx, {
    property,
    actorUserId: undefined,
    action: "property.created",
    entityType: "properties",
    entityId: propertyId,
    metadata: { organizationName, propertyName, timezone },
  });
  return { property, created: true };
}
