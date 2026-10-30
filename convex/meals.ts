import { v } from "convex/values";
import { formatInTimeZone } from "date-fns-tz";
import type { Doc } from "./_generated/dataModel";
import { appError } from "./lib/errors";
import { inScope, internalMutation, residentMutation, residentQuery, staffMutation } from "./lib/functions";
import { isoDateSchema } from "./lib/inputRules";
import { loadMenuLookup } from "./lib/menus";
import { questionFor, residentMessages } from "./lib/messages";
import {
  approvedLeavesOf,
  ensureServices,
  horizonDates,
  ineligibilityOn,
  servicesOn,
  type Ineligibility,
} from "./lib/meals";
import { addDays } from "./lib/time";
import { vSelection } from "./lib/validators";

/** Most days one `myDays` call may return. */
const MAX_DAYS_PER_REQUEST = 14;
/** Most meal choices one save may contain (a week of four meals, with room to spare). */
const MAX_CHOICES_PER_SAVE = 60;

/**
 * Daily scheduled job (see crons.ts): creates meal services for today and
 * the next 7 days. Safe to rerun.
 */
export const generateUpcoming = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let created = 0;
    for (const property of await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect()) {
      created += await ensureServices(ctx, property, horizonDates(now, property.timezone), now);
    }
    return created;
  },
});

/**
 * Creates any missing meal services on demand, so residents can choose
 * meals even before the scheduled job has run. Safe to call repeatedly.
 */
export const ensureUpcoming = residentMutation({
  args: {},
  handler: async (ctx) => {
    const { property } = ctx.resident;
    const now = Date.now();
    return await ensureServices(ctx, property, horizonDates(now, property.timezone), now);
  },
});

/** The same on-demand step for staff screens (dashboard, non-responders). */
export const ensureUpcomingForStaff = staffMutation({
  roles: ["warden"],
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let created = 0;
    for (const property of inScope(ctx.staff)) {
      created += await ensureServices(ctx, property, horizonDates(now, property.timezone), now);
    }
    return created;
  },
});

/**
 * The signed-in resident's meals for `days` consecutive dates starting at
 * `startDate`: what was chosen, when, whether the cutoff has passed, and
 * whether staff changed it. Only ever the caller's own data.
 *
 * Takes the start date from the browser (rather than reading the clock) so
 * the result stays cacheable; it only selects which of the caller's own
 * days to show. Whether a save is on time is decided by `saveChoices`.
 */
export const myDays = residentQuery({
  args: { startDate: v.string(), days: v.number() },
  handler: async (ctx, args) => {
    const start = isoDateSchema.safeParse(args.startDate);
    if (!start.success) throw appError("INVALID_INPUT", start.error.issues[0]?.message);
    if (!Number.isInteger(args.days) || args.days < 1 || args.days > MAX_DAYS_PER_REQUEST) {
      throw appError("INVALID_INPUT", `Ask for between 1 and ${MAX_DAYS_PER_REQUEST} days.`);
    }
    const { property, resident, profile } = ctx.resident;
    const leaves = await approvedLeavesOf(ctx, resident._id);
    const menuFor = await loadMenuLookup(ctx, property);
    const { questions, wasteMessage } = residentMessages(property);

    const days = [];
    for (let i = 0; i < args.days; i += 1) {
      const date = addDays(start.data, i);
      const services = await servicesOn(ctx, property._id, date);
      const meals = await Promise.all(
        services.map(async (service) => {
          const response = await ctx.db
            .query("mealResponses")
            .withIndex("by_service_resident", (q) =>
              q.eq("mealServiceId", service._id).eq("residentId", resident._id),
            )
            .unique();
          let staffChange = null;
          if (response !== null && response.updatedBy !== resident.userId) {
            const entry = await ctx.db
              .query("mealActivityLog")
              .withIndex("by_resident_service", (q) =>
                q.eq("residentId", resident._id).eq("mealServiceId", service._id),
              )
              .order("desc")
              .first();
            staffChange = entry && {
              actorName: entry.actorName,
              actorRole: entry.actorRole,
              reason: entry.reason ?? null,
              at: entry.createdAt,
            };
          }
          return {
            serviceId: service._id,
            mealType: service.mealType,
            name: service.policySnapshot.displayName,
            serviceTime: service.serviceTime,
            endTime: service.endTime ?? null,
            menu: menuFor(date, service.mealType)?.items ?? null,
            cutoffAt: service.cutoffAt,
            cancelled: service.status === "cancelled",
            selection: response?.selection ?? null,
            updatedAt: response?.updatedAt ?? null,
            staffChange,
          };
        }),
      );
      days.push({ date, ineligible: ineligibilityOn(resident, leaves, date), question: questionFor(date, questions), meals });
    }
    return {
      property: {
        name: property.name,
        timezone: property.timezone,
        bannerMinutesBeforeCutoff: property.reminderSettings.bannerMinutesBeforeCutoff,
        wasteMessage,
      },
      resident: { displayName: profile.displayName, roomNumber: resident.roomNumber },
      days,
    };
  },
});

const INELIGIBLE_MESSAGES: Record<Ineligibility, string> = {
  not_active: "Your account isn't active for meals.",
  before_start: "That day is before your stay starts, so you aren't counted for it.",
  after_end: "That day is after your stay ends, so you aren't counted for it.",
  on_leave: "You're on approved leave that day, so you aren't counted for it.",
};

function cutoffMessage(service: Doc<"mealServices">, timezone: string): string {
  const meal = service.policySnapshot.displayName;
  const day = formatInTimeZone(new Date(`${service.serviceDate}T12:00:00Z`), "UTC", "EEE d MMM");
  const closed = formatInTimeZone(new Date(service.cutoffAt), timezone, "h:mm a 'on' EEE d MMM");
  return `Choices for ${meal} on ${day} closed at ${closed}. Contact the Warden to change it.`;
}

/**
 * Saves the resident's Yes/No choices. The server's clock decides whether
 * each choice is before its cutoff. Checking the cutoff, saving and writing
 * the activity log happen in this one transaction: if any choice can't be
 * saved, none are. Re-saving an unchanged choice changes nothing and writes
 * no log entry.
 */
export const saveChoices = residentMutation({
  args: {
    choices: v.array(v.object({ mealServiceId: v.id("mealServices"), selection: vSelection })),
  },
  handler: async (ctx, args) => {
    if (args.choices.length === 0) throw appError("INVALID_INPUT", "There's nothing to save.");
    if (args.choices.length > MAX_CHOICES_PER_SAVE) {
      throw appError("INVALID_INPUT", "Too many choices in one save.");
    }
    const ids = new Set(args.choices.map((c) => c.mealServiceId));
    if (ids.size !== args.choices.length) {
      throw appError("INVALID_INPUT", "The same meal appears twice.");
    }

    const { property, resident, profile, userId } = ctx.resident;
    const leaves = await approvedLeavesOf(ctx, resident._id);
    const now = Date.now();
    let changed = 0;

    for (const choice of args.choices) {
      const service = await ctx.db.get(choice.mealServiceId);
      if (service === null || service.propertyId !== property._id) throw appError("NOT_FOUND");
      if (service.status !== "scheduled") {
        throw appError("INVALID_INPUT", `${service.policySnapshot.displayName} isn't being served that day.`);
      }
      const ineligible = ineligibilityOn(resident, leaves, service.serviceDate);
      if (ineligible !== null) throw appError("NOT_ELIGIBLE", INELIGIBLE_MESSAGES[ineligible]);
      if (now >= service.cutoffAt) {
        throw appError("CUTOFF_PASSED", cutoffMessage(service, property.timezone));
      }

      const existing = await ctx.db
        .query("mealResponses")
        .withIndex("by_service_resident", (q) =>
          q.eq("mealServiceId", service._id).eq("residentId", resident._id),
        )
        .unique();
      if (existing !== null && existing.selection === choice.selection) continue; // No change.

      const version = (existing?.version ?? 0) + 1;
      if (existing === null) {
        await ctx.db.insert("mealResponses", {
          organizationId: property.organizationId,
          propertyId: property._id,
          mealServiceId: service._id,
          residentId: resident._id,
          selection: choice.selection,
          version,
          updatedAt: now,
          updatedBy: userId,
        });
      } else {
        await ctx.db.patch(existing._id, {
          selection: choice.selection,
          version,
          updatedAt: now,
          updatedBy: userId,
        });
      }
      await ctx.db.insert("mealActivityLog", {
        organizationId: property.organizationId,
        propertyId: property._id,
        mealServiceId: service._id,
        residentId: resident._id,
        residentName: resident.displayName,
        roomNumber: resident.roomNumber,
        serviceDate: service.serviceDate,
        mealType: service.mealType,
        mealDisplayName: service.policySnapshot.displayName,
        previousSelection: existing?.selection ?? "none",
        newSelection: choice.selection,
        afterCutoff: false,
        actorUserId: userId,
        actorName: profile.displayName,
        actorRole: "resident",
        source: "resident_app",
        responseVersion: version,
        createdAt: now,
      });
      changed += 1;
    }
    return { savedAt: now, changed };
  },
});
