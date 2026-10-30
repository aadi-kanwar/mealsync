import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { appError } from "./lib/errors";
import { inScope, staffQuery } from "./lib/functions";
import { headcountFor, loadRoster, type Headcount } from "./lib/headcount";
import { isoDateSchema } from "./lib/inputRules";
import { ineligibilityOn, servicesOn } from "./lib/meals";
import { loadMenuLookup } from "./lib/menus";
import { MEAL_TYPES, type MealType } from "./lib/validators";

function parseDate(date: string): string {
  const parsed = isoDateSchema.safeParse(date);
  if (!parsed.success) throw appError("INVALID_INPUT", parsed.error.issues[0]?.message);
  return parsed.data;
}

type MealCounts = {
  serviceId: string;
  mealType: MealType;
  name: string;
  serviceTime: string;
  endTime: string | null;
  menu: string | null;
  cutoffAt: number;
  cancelled: boolean;
  counts: Headcount;
};

/** One property's meals on `date`, with Yes / No / Not answered counts. */
async function propertyDay(ctx: Pick<QueryCtx, "db">, property: Doc<"properties">, date: string): Promise<MealCounts[]> {
  const services = await servicesOn(ctx, property._id, date);
  const roster = await loadRoster(ctx, property._id);
  const menuFor = await loadMenuLookup(ctx, property);
  return await Promise.all(
    services.map(async (service) => ({
      serviceId: service._id as string,
      mealType: service.mealType,
      name: service.policySnapshot.displayName,
      serviceTime: service.serviceTime,
      endTime: service.endTime ?? null,
      menu: menuFor(date, service.mealType)?.items ?? null,
      cutoffAt: service.cutoffAt,
      cancelled: service.status === "cancelled",
      counts: (await headcountFor(ctx, service, roster)).counts,
    })),
  );
}

/** Adds up the same meal across properties (cancelled ones don't count). */
function combine(perProperty: MealCounts[][]): MealCounts[] {
  const byType = new Map<MealType, MealCounts>();
  for (const meal of perProperty.flat()) {
    const sum = byType.get(meal.mealType);
    if (sum === undefined) {
      byType.set(meal.mealType, { ...meal, serviceId: meal.mealType, menu: null, counts: { ...meal.counts } });
      if (meal.cancelled) byType.get(meal.mealType)!.counts = zero();
      continue;
    }
    sum.serviceTime = meal.serviceTime < sum.serviceTime ? meal.serviceTime : sum.serviceTime;
    sum.endTime = sum.endTime && meal.endTime && meal.endTime > sum.endTime ? meal.endTime : sum.endTime;
    sum.cutoffAt = Math.min(sum.cutoffAt, meal.cutoffAt);
    sum.cancelled = sum.cancelled && meal.cancelled;
    if (meal.cancelled) continue;
    sum.counts = {
      eligible: sum.counts.eligible + meal.counts.eligible,
      yes: sum.counts.yes + meal.counts.yes,
      no: sum.counts.no + meal.counts.no,
      unanswered: sum.counts.unanswered + meal.counts.unanswered,
      notCounted: sum.counts.notCounted + meal.counts.notCounted,
      balanced: sum.counts.balanced && meal.counts.balanced,
    };
  }
  return MEAL_TYPES.flatMap((type) => byType.get(type) ?? []);
}

function zero(): Headcount {
  return { eligible: 0, yes: 0, no: 0, unanswered: 0, notCounted: 0, balanced: true };
}

/**
 * The headcount for one date: for each meal, how many residents said Yes,
 * said No, and haven't answered. For one property, or all the caller's
 * properties added up (with each property's numbers alongside). Counts only,
 * no personal details. Updates live as residents answer. Admin/Warden.
 */
export const day = staffQuery({
  roles: ["warden"],
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = parseDate(args.date);
    const properties = inScope(ctx.staff);
    const perProperty = await Promise.all(properties.map((p) => propertyDay(ctx, p, date)));
    const single = properties.length === 1;
    return {
      date,
      timezone: properties[0]?.timezone ?? "Asia/Kolkata",
      meals: single ? perProperty[0] : combine(perProperty),
      properties: single
        ? []
        : properties.map((p, i) => ({
            propertyId: p._id,
            name: p.name,
            meals: perProperty[i].map(({ mealType, name, cancelled, counts }) => ({ mealType, name, cancelled, counts })),
          })),
    };
  },
});

/**
 * Every resident counted on `date` (in one property or all the caller's),
 * with what they chose for each meal (Yes, No, not answered, or "not served"
 * where their property doesn't serve it) and when they last saved a choice
 * that day. Names and rooms only, never phone numbers. Admin/Warden.
 */
export const responses = staffQuery({
  roles: ["warden"],
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = parseDate(args.date);
    const properties = inScope(ctx.staff);
    const perProperty = await Promise.all(
      properties.map(async (property) => ({
        property,
        services: (await servicesOn(ctx, property._id, date)).filter((s) => s.status === "scheduled"),
        roster: await loadRoster(ctx, property._id),
      })),
    );
    const columns = MEAL_TYPES.flatMap((type) => {
      const service = perProperty.flatMap((p) => p.services).find((s) => s.mealType === type);
      return service ? [{ mealType: type, name: service.policySnapshot.displayName }] : [];
    });
    const residents = [];
    for (const { property, services, roster } of perProperty) {
      const counted = roster.residents.filter(
        (r) => ineligibilityOn(r, roster.leavesByResident.get(r._id) ?? [], date) === null,
      );
      const byType = new Map(
        await Promise.all(
          services.map(async (service) => {
            const rows = await ctx.db
              .query("mealResponses")
              .withIndex("by_service", (q) => q.eq("mealServiceId", service._id))
              .collect();
            return [service.mealType, new Map(rows.map((r) => [r.residentId, r]))] as const;
          }),
        ),
      );
      for (const resident of counted) {
        const answers = columns.map((c) => {
          const map = byType.get(c.mealType);
          return map === undefined ? ("not_served" as const) : (map.get(resident._id) ?? null);
        });
        const saved = answers.flatMap((a) => (a && a !== "not_served" ? [a.updatedAt] : []));
        residents.push({
          residentId: resident._id,
          displayName: resident.displayName,
          roomNumber: resident.roomNumber,
          propertyId: property._id,
          propertyName: property.name,
          selections: answers.map((a) => (a === "not_served" ? a : (a?.selection ?? null))),
          lastSavedAt: saved.length > 0 ? Math.max(...saved) : null,
        });
      }
    }
    residents.sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }),
    );
    return {
      date,
      timezone: properties[0]?.timezone ?? "Asia/Kolkata",
      meals: columns.map((c) => ({ mealType: c.mealType, name: c.name })),
      residents,
    };
  },
});
