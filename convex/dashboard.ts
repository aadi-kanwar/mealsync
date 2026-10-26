import { v } from "convex/values";
import { appError } from "./lib/errors";
import { staffQuery } from "./lib/functions";
import { headcountFor, loadRoster } from "./lib/headcount";
import { isoDateSchema } from "./lib/inputRules";
import { servicesOn } from "./lib/meals";
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

/** Who hasn't answered, per meal (names and rooms, never phone numbers), so the Warden can remind them. */
export const nonResponders = staffQuery({
  roles: ["warden"],
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = parseDate(args.date);
    const { property } = ctx.staff;
    const services = await servicesOn(ctx, property._id, date);
    const roster = await loadRoster(ctx, property._id);
    const meals = await Promise.all(
      services
        .filter((service) => service.status === "scheduled")
        .map(async (service) => {
          const { counts, nonResponders } = await headcountFor(ctx, service, roster);
          return {
            serviceId: service._id,
            name: service.policySnapshot.displayName,
            serviceTime: service.serviceTime,
            endTime: service.endTime ?? null,
            cutoffAt: service.cutoffAt,
            eligible: counts.eligible,
            people: nonResponders.map((r) => ({
              residentId: r._id,
              roomNumber: r.roomNumber,
              displayName: r.displayName,
            })),
          };
        }),
    );
    return { date, timezone: property.timezone, meals };
  },
});
