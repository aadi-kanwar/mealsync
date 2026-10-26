import { v } from "convex/values";
import { appError } from "./lib/errors";
import { staffQuery } from "./lib/functions";
import { headcountFor, loadRoster } from "./lib/headcount";
import { isoDateSchema } from "./lib/inputRules";
import { ineligibilityOn, servicesOn } from "./lib/meals";
import { loadMenuLookup } from "./lib/menus";

function parseDate(date: string): string {
  const parsed = isoDateSchema.safeParse(date);
  if (!parsed.success) throw appError("INVALID_INPUT", parsed.error.issues[0]?.message);
  return parsed.data;
}

/**
 * The headcount for one date: for each meal, how many residents said Yes,
 * said No, and haven't answered. Counts only, no personal details. Updates
 * live as residents answer. Admin/Warden.
 */
export const day = staffQuery({
  roles: ["warden"],
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = parseDate(args.date);
    const { property } = ctx.staff;
    const services = await servicesOn(ctx, property._id, date);
    const roster = await loadRoster(ctx, property._id);
    const menuFor = await loadMenuLookup(ctx, property);
    const meals = await Promise.all(
      services.map(async (service) => ({
        serviceId: service._id,
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
    return { date, timezone: property.timezone, meals };
  },
});

/**
 * Every resident counted on `date`, with what they chose for each meal (Yes,
 * No, or not answered) and when they last saved a choice for that day.
 * Names and rooms only, never phone numbers. Admin/Warden.
 */
export const responses = staffQuery({
  roles: ["warden"],
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = parseDate(args.date);
    const { property } = ctx.staff;
    const services = (await servicesOn(ctx, property._id, date)).filter((s) => s.status === "scheduled");
    const roster = await loadRoster(ctx, property._id);
    const counted = roster.residents.filter(
      (r) => ineligibilityOn(r, roster.leavesByResident.get(r._id) ?? [], date) === null,
    );
    const byService = await Promise.all(
      services.map(async (service) => {
        const rows = await ctx.db
          .query("mealResponses")
          .withIndex("by_service", (q) => q.eq("mealServiceId", service._id))
          .collect();
        return new Map(rows.map((r) => [r.residentId, r]));
      }),
    );
    const residents = counted
      .map((resident) => {
        const answers = byService.map((map) => map.get(resident._id) ?? null);
        const saved = answers.flatMap((a) => (a ? [a.updatedAt] : []));
        return {
          residentId: resident._id,
          displayName: resident.displayName,
          roomNumber: resident.roomNumber,
          selections: answers.map((a) => a?.selection ?? null),
          lastSavedAt: saved.length > 0 ? Math.max(...saved) : null,
        };
      })
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
    return {
      date,
      timezone: property.timezone,
      meals: services.map((s) => ({ serviceId: s._id, name: s.policySnapshot.displayName })),
      residents,
    };
  },
});
