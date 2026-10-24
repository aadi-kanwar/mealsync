import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { addDays, computeCutoffAt, localDateString, weekdayOf } from "./time";

type DbCtx = Pick<QueryCtx, "db">;

/** Meal services are kept ready for today and this many days after it. */
export const SERVICE_HORIZON_DAYS = 7;

/** Today (property-local) through today + SERVICE_HORIZON_DAYS. */
export function horizonDates(nowMs: number, timezone: string): string[] {
  const today = localDateString(nowMs, timezone);
  return Array.from({ length: SERVICE_HORIZON_DAYS + 1 }, (_, i) => addDays(today, i));
}

/** Whether `slot` serves a meal on `date` (active, in its date range, on that weekday). */
export function slotRunsOn(slot: Doc<"mealSlots">, date: string): boolean {
  if (!slot.active) return false;
  if (date < slot.effectiveFrom) return false;
  if (slot.effectiveUntil !== undefined && date > slot.effectiveUntil) return false;
  return slot.serviceDays.includes(weekdayOf(date));
}

/**
 * Creates any missing meal services for `dates`. Safe to run any number of
 * times: an existing service (one per property + date + meal) is never
 * duplicated or changed, so later edits to a slot's timings or cutoff only
 * affect services created after the edit. Returns how many were created.
 */
export async function ensureServices(
  ctx: Pick<MutationCtx, "db">,
  property: Doc<"properties">,
  dates: readonly string[],
  nowMs: number,
): Promise<number> {
  const slots = (
    await ctx.db
      .query("mealSlots")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .collect()
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  let created = 0;
  for (const date of dates) {
    for (const slot of slots) {
      if (!slotRunsOn(slot, date)) continue;
      const existing = await ctx.db
        .query("mealServices")
        .withIndex("by_property_date_meal", (q) =>
          q.eq("propertyId", property._id).eq("serviceDate", date).eq("mealType", slot.mealType),
        )
        .first();
      if (existing !== null) continue;
      await ctx.db.insert("mealServices", {
        organizationId: property.organizationId,
        propertyId: property._id,
        serviceDate: date,
        mealType: slot.mealType,
        mealSlotId: slot._id,
        serviceTime: slot.serviceTime,
        cutoffAt: computeCutoffAt(date, slot.cutoffRule, property.timezone),
        status: "scheduled",
        policySnapshot: {
          displayName: slot.displayName,
          serviceTime: slot.serviceTime,
          cutoffRule: slot.cutoffRule,
          timezone: property.timezone,
        },
        createdAt: nowMs,
      });
      created += 1;
    }
  }
  return created;
}

/** A property's meal services on one date, in serving order. */
export async function servicesOn(
  ctx: DbCtx,
  propertyId: Id<"properties">,
  date: string,
): Promise<Doc<"mealServices">[]> {
  const services = await ctx.db
    .query("mealServices")
    .withIndex("by_property_date", (q) => q.eq("propertyId", propertyId).eq("serviceDate", date))
    .collect();
  return services.sort((a, b) => a.serviceTime.localeCompare(b.serviceTime));
}

export type Ineligibility = "not_active" | "before_start" | "after_end" | "on_leave";

/**
 * Why a resident doesn't count for meals on `date`, or null if they do.
 * Eligible means: active (approved) resident of the property, `date` within
 * validFrom..validUntil (inclusive), and no approved leave covering `date`.
 */
export function ineligibilityOn(
  resident: Doc<"residents">,
  approvedLeaves: readonly Pick<Doc<"leaves">, "startDate" | "endDate">[],
  date: string,
): Ineligibility | null {
  if (resident.status !== "active") return "not_active";
  if (resident.validFrom === undefined || date < resident.validFrom) return "before_start";
  if (resident.validUntil !== undefined && date > resident.validUntil) return "after_end";
  if (approvedLeaves.some((leave) => leave.startDate <= date && date <= leave.endDate)) {
    return "on_leave";
  }
  return null;
}

export async function approvedLeavesOf(
  ctx: DbCtx,
  residentId: Id<"residents">,
): Promise<Doc<"leaves">[]> {
  const leaves = await ctx.db
    .query("leaves")
    .withIndex("by_resident", (q) => q.eq("residentId", residentId))
    .collect();
  return leaves.filter((leave) => leave.status === "approved");
}
