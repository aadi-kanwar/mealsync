import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";
import {
  MAX_MESSAGE_LENGTH,
  MAX_QUESTION_LENGTH,
  QUESTION_COUNT,
  residentMessages,
} from "./lib/messages";
import { MAX_REMINDER_TIMES, reminderSettings } from "./lib/reminders";
import { ensureServices, horizonDates, slotRunsOn } from "./lib/meals";
import { computeCutoffAt, isClock, localDateString } from "./lib/time";
import { vMealType } from "./lib/validators";

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
    const slots = (
      await ctx.db
        .query("mealSlots")
        .withIndex("by_property", (q) => q.eq("propertyId", property._id))
        .collect()
    ).sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      organizationName: organization?.name ?? "",
      propertyName: property.name,
      timezone: property.timezone,
      ...residentMessages(property),
      meals: slots.map((s) => ({
        mealType: s.mealType,
        displayName: s.displayName,
        serviceTime: s.serviceTime,
        endTime: s.endTime,
        serviceDays: [...s.serviceDays].sort(),
        active: s.active,
      })),
      cutoff: slots[0]?.cutoffRule ?? { daysBefore: 0, time: "06:00" },
      warnMinutes: property.reminderSettings.bannerMinutesBeforeCutoff,
      reminders: reminderSettings(property),
      // How many residents have reminders turned on (on at least one phone).
      residentsWithReminders: new Set(
        (
          await ctx.db
            .query("pushSubscriptions")
            .withIndex("by_property", (q) => q.eq("propertyId", property._id))
            .collect()
        ).map((s) => s.userId),
      ).size,
    };
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

/**
 * The question of the day (three, taking turns day by day) and the food-waste
 * message residents see above their meals. Admin only; audited.
 */
export const updateResidentMessages = staffMutation({
  roles: [],
  args: { questions: v.array(v.string()), wasteMessage: v.string() },
  handler: async (ctx, args) => {
    if (args.questions.length !== QUESTION_COUNT) {
      throw appError("INVALID_INPUT", `Enter ${QUESTION_COUNT} questions.`);
    }
    const questions = args.questions.map((q) => q.trim().replace(/\s+/g, " "));
    if (questions.some((q) => q.length < 3 || q.length > MAX_QUESTION_LENGTH)) {
      throw appError("INVALID_INPUT", `Each question must be 3 to ${MAX_QUESTION_LENGTH} characters.`);
    }
    const wasteMessage = args.wasteMessage.trim();
    if (wasteMessage.length < 10 || wasteMessage.length > MAX_MESSAGE_LENGTH) {
      throw appError("INVALID_INPUT", `The message must be 10 to ${MAX_MESSAGE_LENGTH} characters.`);
    }
    const { property, userId } = ctx.staff;
    await ctx.db.patch(property._id, { dailyQuestions: questions, wasteMessage });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "settings.updated",
      entityType: "properties",
      entityId: property._id,
      metadata: { before: residentMessages(property), after: { questions, wasteMessage } },
    });
    return null;
  },
});

/** How long before the deadline residents' screens turn amber, in minutes. */
export const WARN_MINUTES = [30, 60, 120, 180, 240, 360] as const;

/**
 * Meals (name, served or not, which days, times), the deadline to choose,
 * and when the "deadline is close" warning shows. Admin only; audited.
 * Coming days still open for choosing take the changes; days already
 * closed keep what they had. A meal no longer served on an open day is
 * removed, or marked not served if someone has already answered for it.
 */
export const updateMeals = staffMutation({
  roles: [],
  args: {
    meals: v.array(
      v.object({
        mealType: vMealType,
        displayName: v.string(),
        serviceTime: v.string(),
        endTime: v.string(),
        serviceDays: v.array(v.number()),
        active: v.boolean(),
      }),
    ),
    cutoff: v.object({ daysBefore: v.number(), time: v.string() }),
    warnMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const { property, userId } = ctx.staff;
    const { daysBefore, time } = args.cutoff;
    if ((daysBefore !== 0 && daysBefore !== 1) || !isClock(time)) {
      throw appError("INVALID_INPUT", "Choose a deadline on the day or the day before, as a time like 06:00.");
    }
    if (!(WARN_MINUTES as readonly number[]).includes(args.warnMinutes)) {
      throw appError("INVALID_INPUT", "Choose when the deadline warning shows.");
    }
    const changes = new Map<string, (typeof args.meals)[number]>();
    for (const meal of args.meals) {
      if (changes.has(meal.mealType)) throw appError("INVALID_INPUT", "A meal appears twice.");
      const displayName = meal.displayName.trim().replace(/\s+/g, " ");
      if (displayName.length < 2 || displayName.length > 30) {
        throw appError("INVALID_INPUT", "Meal names must be 2 to 30 characters.");
      }
      if (!isClock(meal.serviceTime) || !isClock(meal.endTime)) {
        throw appError("INVALID_INPUT", "Enter times like 07:30.");
      }
      if (meal.endTime <= meal.serviceTime) throw appError("INVALID_INPUT", `${displayName} must end after it starts.`);
      const serviceDays = [...new Set(meal.serviceDays)].sort();
      if (serviceDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw appError("INVALID_INPUT", "Unknown day.");
      if (meal.active && serviceDays.length === 0) {
        throw appError("INVALID_INPUT", `Choose at least one day for ${displayName}, or turn it off.`);
      }
      changes.set(meal.mealType, { ...meal, displayName, serviceDays });
    }
    const slots = await ctx.db
      .query("mealSlots")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .collect();
    for (const mealType of changes.keys()) {
      if (!slots.some((s) => s.mealType === mealType)) throw appError("INVALID_INPUT", "Unknown meal.");
    }
    const rule = { daysBefore, time };
    const updatedSlots = slots.map((slot) => {
      const change = changes.get(slot.mealType);
      return {
        ...slot,
        cutoffRule: rule,
        ...(change
          ? {
              displayName: change.displayName,
              serviceTime: change.serviceTime,
              endTime: change.endTime,
              serviceDays: change.serviceDays,
              active: change.active,
            }
          : {}),
      };
    });
    if (!updatedSlots.some((s) => s.active)) throw appError("INVALID_INPUT", "At least one meal must be served.");

    const before = {
      meals: slots.map(({ mealType, displayName, serviceTime, endTime, serviceDays, active }) => ({
        mealType,
        displayName,
        serviceTime,
        endTime,
        serviceDays,
        active,
      })),
      cutoff: slots[0]?.cutoffRule ?? null,
      warnMinutes: property.reminderSettings.bannerMinutesBeforeCutoff,
    };
    for (const slot of updatedSlots) {
      const { _id, _creationTime, ...fields } = slot;
      void _creationTime;
      await ctx.db.patch(_id, fields);
    }
    if (args.warnMinutes !== property.reminderSettings.bannerMinutesBeforeCutoff) {
      await ctx.db.patch(property._id, {
        reminderSettings: { ...property.reminderSettings, bannerMinutesBeforeCutoff: args.warnMinutes },
      });
    }

    // Coming days that are still open take the changes.
    const now = Date.now();
    const today = localDateString(now, property.timezone);
    const services = await ctx.db
      .query("mealServices")
      .withIndex("by_property_date", (q) => q.eq("propertyId", property._id).gte("serviceDate", today))
      .collect();
    let updated = 0;
    for (const service of services) {
      const newCutoff = computeCutoffAt(service.serviceDate, rule, property.timezone);
      if (now >= service.cutoffAt || now >= newCutoff) continue;
      const slot = updatedSlots.find((s) => s.mealType === service.mealType);
      if (slot === undefined) continue;
      updated += 1;
      if (!slotRunsOn(slot, service.serviceDate)) {
        const answered = await ctx.db
          .query("mealResponses")
          .withIndex("by_service", (q) => q.eq("mealServiceId", service._id))
          .first();
        if (answered === null) await ctx.db.delete(service._id);
        else if (service.status !== "cancelled") await ctx.db.patch(service._id, { status: "cancelled" });
        continue;
      }
      await ctx.db.patch(service._id, {
        serviceTime: slot.serviceTime,
        endTime: slot.endTime,
        cutoffAt: newCutoff,
        // Served again after being turned off.
        status: "scheduled",
        policySnapshot: {
          ...service.policySnapshot,
          displayName: slot.displayName,
          serviceTime: slot.serviceTime,
          endTime: slot.endTime,
          cutoffRule: rule,
        },
      });
    }
    // Meals or days that were just turned on.
    updated += await ensureServices(ctx, property, horizonDates(now, property.timezone), now);

    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "settings.meal_times_updated",
      entityType: "properties",
      entityId: property._id,
      metadata: { before, after: { meals: args.meals, cutoff: rule, warnMinutes: args.warnMinutes }, openMealsUpdated: updated },
    });
    return { openMealsUpdated: updated };
  },
});

/** Phone reminders: on/off and when they go out (property-local times). Admin only; audited. */
export const updateReminders = staffMutation({
  roles: [],
  args: { enabled: v.boolean(), times: v.array(v.string()) },
  handler: async (ctx, args) => {
    const times = [...new Set(args.times.map((t) => t.trim()))].sort();
    if (times.some((t) => !isClock(t))) throw appError("INVALID_INPUT", "Enter times like 21:00.");
    if (times.length > MAX_REMINDER_TIMES) {
      throw appError("INVALID_INPUT", `At most ${MAX_REMINDER_TIMES} reminders a day.`);
    }
    if (args.enabled && times.length === 0) throw appError("INVALID_INPUT", "Add at least one reminder time.");
    const { property, userId } = ctx.staff;
    await ctx.db.patch(property._id, { remindersEnabled: args.enabled, reminderTimes: times });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "settings.reminders_updated",
      entityType: "properties",
      entityId: property._id,
      metadata: { before: reminderSettings(property), after: { enabled: args.enabled, times } },
    });
    return null;
  },
});


