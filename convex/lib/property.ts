import type { Doc, Id } from "../_generated/dataModel";
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

/** Organisation and property names: 2 to 80 characters, spaces tidied. */
export function checkName(value: string, what: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw appError("INVALID_INPUT", `${what} must be 2 to 80 characters.`);
  return name;
}

/** A slug not yet used, made from `name` (adds -2, -3... when taken). */
async function freeSlug(name: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(name);
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(slug))) return slug;
  }
}

/** Creates an organisation. Callers make its creator an Admin. */
export async function createOrganization(
  ctx: Pick<MutationCtx, "db">,
  args: { name: string; createdBy: Id<"users"> | undefined },
): Promise<Doc<"organizations">> {
  const name = checkName(args.name, "The organisation name");
  const slug = await freeSlug(name, async (slug) =>
    (await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first()) !== null,
  );
  const organizationId = await ctx.db.insert("organizations", {
    name,
    slug,
    status: "active",
    createdBy: args.createdBy,
    createdAt: Date.now(),
  });
  const organization = (await ctx.db.get(organizationId))!;
  await writeAudit(ctx, {
    property: { organizationId },
    actorUserId: args.createdBy,
    action: "organization.created",
    entityType: "organizations",
    entityId: organizationId,
    metadata: { name },
  });
  return organization;
}

/** Creates a property (PG) in an organisation, with the default meals and deadline. */
export async function createProperty(
  ctx: Pick<MutationCtx, "db">,
  args: { organizationId: Id<"organizations">; name: string; timezone?: string; createdBy: Id<"users"> | undefined },
): Promise<Doc<"properties">> {
  const name = checkName(args.name, "The property name");
  const timezone = args.timezone ?? DEFAULT_TIMEZONE;
  if (!isValidTimezone(timezone)) throw appError("INVALID_INPUT", "Unknown timezone.");
  const sameName = (
    await ctx.db
      .query("properties")
      .withIndex("by_org_status", (q) => q.eq("organizationId", args.organizationId).eq("status", "active"))
      .collect()
  ).some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (sameName) throw appError("CONFLICT", "There's already a property with that name.");
  const slug = await freeSlug(name, async (slug) =>
    (await ctx.db
      .query("properties")
      .withIndex("by_org_slug", (q) => q.eq("organizationId", args.organizationId).eq("slug", slug))
      .first()) !== null,
  );
  const propertyId = await ctx.db.insert("properties", {
    organizationId: args.organizationId,
    name,
    slug,
    timezone,
    status: "active",
    reminderSettings: { bannerMinutesBeforeCutoff: 120 },
  });
  const property = (await ctx.db.get(propertyId))!;

  const today = localDateString(Date.now(), timezone);
  for (const [index, slot] of DEFAULT_MEAL_SLOTS.entries()) {
    await ctx.db.insert("mealSlots", {
      organizationId: args.organizationId,
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
    actorUserId: args.createdBy,
    action: "property.created",
    entityType: "properties",
    entityId: propertyId,
    metadata: { name, timezone },
  });
  return property;
}

/**
 * First-time setup by the owner (also run by every production build): if
 * no property exists at all, creates an organisation with one property.
 * Otherwise returns the first one unchanged.
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
  const organization = await createOrganization(ctx, { name: args.organizationName, createdBy: undefined });
  const property = await createProperty(ctx, {
    organizationId: organization._id,
    name: args.propertyName,
    timezone: args.timezone,
    createdBy: undefined,
  });
  return { property, created: true };
}
