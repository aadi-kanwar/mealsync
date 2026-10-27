import { v } from "convex/values";
import { formatInTimeZone } from "date-fns-tz";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { appError } from "./lib/errors";
import { internalMutation, residentMutation, signedInMutation, signedInQuery, viewerQuery } from "./lib/functions";
import { loadRoster } from "./lib/headcount";
import { ineligibilityOn, servicesOn } from "./lib/meals";
import { reminderSettings } from "./lib/reminders";
import { addDays, localDateString } from "./lib/time";

/** How late a reminder may still go out (e.g. right after a deploy), in minutes. */
const SEND_WINDOW_MINUTES = 30;

/** The public half of the push signing key. Browsers need it to subscribe. */
export const publicKey = viewerQuery({
  args: {},
  handler: async () => ({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null }),
});

function checkSubscription(args: { endpoint: string; p256dh: string; auth: string }) {
  let url: URL;
  try {
    url = new URL(args.endpoint);
  } catch {
    throw appError("INVALID_INPUT", "That notification address isn't valid.");
  }
  if (url.protocol !== "https:" || args.endpoint.length > 1000 || args.p256dh.length > 200 || args.auth.length > 100) {
    throw appError("INVALID_INPUT", "That notification address isn't valid.");
  }
}

/** Saves this phone/browser to receive reminders. Approved residents only. */
export const subscribe = residentMutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, args) => {
    checkSubscription(args);
    const { property, userId } = ctx.resident;
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    // A shared device that someone else used before now belongs to this person.
    if (existing !== null) await ctx.db.delete(existing._id);
    await ctx.db.insert("pushSubscriptions", {
      organizationId: property.organizationId,
      propertyId: property._id,
      userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      createdAt: Date.now(),
    });
    return null;
  },
});

/** Stops reminders on this phone/browser. Only for the caller's own device. */
export const unsubscribe = signedInMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing !== null && existing.userId === ctx.viewer.userId) await ctx.db.delete(existing._id);
    return null;
  },
});

/** Whether this phone/browser is set up for the caller's reminders. */
export const isSubscribed = signedInQuery({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    return existing !== null && existing.userId === ctx.viewer.userId;
  },
});

const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** The reminder time due now (within its send window), if any. */
export function dueReminder(times: readonly string[], localClock: string): string | null {
  const now = minutesOf(localClock);
  for (const time of times) {
    const late = (now - minutesOf(time) + 24 * 60) % (24 * 60);
    if (late < SEND_WINDOW_MINUTES) return time;
  }
  return null;
}

/**
 * Who to remind: residents counted on the next day that's still open for
 * choosing, who haven't answered every open meal that day.
 */
export async function reminderTargets(ctx: Pick<QueryCtx, "db">, property: Doc<"properties">, now: number) {
  const today = localDateString(now, property.timezone);
  for (const date of [today, addDays(today, 1)]) {
    const open = (await servicesOn(ctx, property._id, date)).filter(
      (s) => s.status === "scheduled" && now < s.cutoffAt,
    );
    if (open.length === 0) continue;
    const roster = await loadRoster(ctx, property._id);
    const answered = new Map<Id<"residents">, number>();
    for (const service of open) {
      for (const r of await ctx.db
        .query("mealResponses")
        .withIndex("by_service", (q) => q.eq("mealServiceId", service._id))
        .collect()) {
        answered.set(r.residentId, (answered.get(r.residentId) ?? 0) + 1);
      }
    }
    const residents = roster.residents.filter(
      (r) =>
        ineligibilityOn(r, roster.leavesByResident.get(r._id) ?? [], date) === null &&
        (answered.get(r._id) ?? 0) < open.length,
    );
    const cutoff = Math.min(...open.map((s) => s.cutoffAt));
    return { date, isToday: date === today, cutoff, residents };
  }
  return null;
}

/**
 * Scheduled every 5 minutes (crons.ts): sends a reminder when one is due and
 * hasn't gone out yet today.
 */
export const sendDueReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .first();
    if (property === null) return { sent: 0 };
    const settings = reminderSettings(property);
    if (!settings.enabled) return { sent: 0 };
    const now = Date.now();
    const time = dueReminder(settings.times, formatInTimeZone(new Date(now), property.timezone, "HH:mm"));
    if (time === null) return { sent: 0 };
    // A reminder due just after midnight belongs to the day it fires on.
    const date = localDateString(now, property.timezone);
    const already = await ctx.db
      .query("reminderRuns")
      .withIndex("by_property_date_time", (q) => q.eq("propertyId", property._id).eq("date", date).eq("time", time))
      .first();
    if (already !== null) return { sent: 0 };

    const targets = await reminderTargets(ctx, property, now);
    const userIds = new Set(targets?.residents.map((r) => r.userId) ?? []);
    const devices = [];
    for (const userId of userIds) {
      for (const sub of await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()) {
        devices.push({ subscriptionId: sub._id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
      }
    }
    await ctx.db.insert("reminderRuns", {
      propertyId: property._id,
      date,
      time,
      sentAt: now,
      recipients: devices.length,
    });
    if (targets !== null && devices.length > 0) {
      const by = formatInTimeZone(new Date(targets.cutoff), property.timezone, "h:mm a");
      await ctx.scheduler.runAfter(0, internal.push.send, {
        devices,
        title: "Dine: choose your meals",
        body: `You haven't chosen all your meals for ${targets.isToday ? "today" : "tomorrow"} yet. Please answer by ${by}, so nothing is cooked to be thrown away.`,
        url: "/home",
      });
    }
    return { sent: devices.length };
  },
});

/** Removes devices the push service says no longer exist. */
export const removeSubscriptions = internalMutation({
  args: { ids: v.array(v.id("pushSubscriptions")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      if ((await ctx.db.get(id)) !== null) await ctx.db.delete(id);
    }
    return null;
  },
});
