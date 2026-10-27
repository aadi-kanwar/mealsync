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
    )
      .filter((s) => s.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);
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
      })),
      cutoff: slots[0]?.cutoffRule ?? { daysBefore: 0, time: "06:00" },
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

/**
 * Meal times and the deadline for choosing (the same for every meal: either
 * that morning or the evening before, at a set time). Admin only; audited.
 *
 * Applies to new days and to coming days that are still open for choosing.
 * Meals whose deadline has already passed are never reopened or changed.
 */
export const updateMealTimes = staffMutation({
  roles: [],
  args: {
    meals: v.array(v.object({ mealType: vMealType, serviceTime: v.string(), endTime: v.string() })),
    cutoff: v.object({ daysBefore: v.number(), time: v.string() }),
  },
  handler: async (ctx, args) => {
    const { property, userId } = ctx.staff;
    const { daysBefore, time } = args.cutoff;
    if ((daysBefore !== 0 && daysBefore !== 1) || !isClock(time)) {
      throw appError("INVALID_INPUT", "Choose a deadline on the day or the evening before, as a time like 06:00.");
    }
    for (const meal of args.meals) {
      if (!isClock(meal.serviceTime) || !isClock(meal.endTime)) {
        throw appError("INVALID_INPUT", "Enter times like 07:30.");
      }
      if (meal.endTime <= meal.serviceTime) {
        throw appError("INVALID_INPUT", "Each meal must end after it starts.");
      }
    }
    const slots = await ctx.db
      .query("mealSlots")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .collect();
    const changes = new Map(args.meals.map((m) => [m.mealType, m]));
    if (changes.size !== args.meals.length) throw appError("INVALID_INPUT", "A meal appears twice.");
    for (const mealType of changes.keys()) {
      if (!slots.some((s) => s.mealType === mealType)) throw appError("INVALID_INPUT", "Unknown meal.");
    }
    const earliest = [...slots.map((s) => changes.get(s.mealType)?.serviceTime ?? s.serviceTime)].sort()[0];
    if (daysBefore === 0 && earliest !== undefined && time > earliest) {
      throw appError("INVALID_INPUT", `The deadline must be before the first meal starts (${earliest}).`);
    }

    const rule = { daysBefore, time };
    const before = slots.map((s) => ({ mealType: s.mealType, serviceTime: s.serviceTime, endTime: s.endTime, cutoff: s.cutoffRule }));
    for (const slot of slots) {
      const change = changes.get(slot.mealType);
      await ctx.db.patch(slot._id, {
        cutoffRule: rule,
        ...(change ? { serviceTime: change.serviceTime, endTime: change.endTime } : {}),
      });
    }

    // Coming days that are still open take the new times and deadline.
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
      const slot = slots.find((s) => s.mealType === service.mealType);
      const change = changes.get(service.mealType);
      const serviceTime = change?.serviceTime ?? slot?.serviceTime ?? service.serviceTime;
      const endTime = change?.endTime ?? slot?.endTime ?? service.endTime;
      await ctx.db.patch(service._id, {
        serviceTime,
        endTime,
        cutoffAt: newCutoff,
        policySnapshot: { ...service.policySnapshot, serviceTime, endTime, cutoffRule: rule },
      });
      updated += 1;
    }
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "settings.meal_times_updated",
      entityType: "properties",
      entityId: property._id,
      metadata: { before, after: { meals: args.meals, cutoff: rule }, openMealsUpdated: updated },
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


