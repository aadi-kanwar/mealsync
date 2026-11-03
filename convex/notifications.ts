import { v } from "convex/values";
import { formatInTimeZone } from "date-fns-tz";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appError } from "./lib/errors";
import {
  getProfile,
  getResidentRecord,
  getStaffAccess,
  internalMutation,
  oneProperty,
  signedInMutation,
  signedInQuery,
  staffMutation,
  viewerQuery,
} from "./lib/functions";
import { loadRoster } from "./lib/headcount";
import { ineligibilityOn, servicesOn } from "./lib/meals";
import { reminderSettings, reminderText } from "./lib/reminders";
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

/**
 * Saves this phone/browser to receive notifications. Approved residents get
 * meal reminders; staff can turn it on to receive test notifications.
 */
export const subscribe = signedInMutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, args) => {
    checkSubscription(args);
    const { userId } = ctx.viewer;
    const profile = await getProfile(ctx, userId);
    if (profile === null || profile.status !== "active") throw appError("FORBIDDEN");
    const resident = await getResidentRecord(ctx, userId);
    const staff = await getStaffAccess(ctx, userId);
    const property =
      resident?.status === "active" ? await ctx.db.get(resident.propertyId) : (staff?.properties[0] ?? null);
    if (property === null) throw appError("FORBIDDEN");
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
 * Scheduled every 5 minutes (crons.ts): for each property, sends a reminder
 * when one is due and hasn't gone out yet today.
 */
export const sendDueReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    let sent = 0;
    for (const property of await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect()) {
      sent += await sendDueAt(ctx, property);
    }
    return { sent };
  },
});

/** One property's due reminder, if any. Returns how many devices it went to. */
async function sendDueAt(ctx: MutationCtx, property: Doc<"properties">): Promise<number> {
  const settings = reminderSettings(property);
  if (!settings.enabled) return 0;
  const now = Date.now();
  const time = dueReminder(settings.times, formatInTimeZone(new Date(now), property.timezone, "HH:mm"));
  if (time === null) return 0;
  // A reminder due just after midnight belongs to the day it fires on.
  const date = localDateString(now, property.timezone);
  const already = await ctx.db
    .query("reminderRuns")
    .withIndex("by_property_date_time", (q) => q.eq("propertyId", property._id).eq("date", date).eq("time", time))
    .first();
  if (already !== null) return 0;

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
    const text = reminderText(property, {
      day: targets.isToday ? "today" : "tomorrow",
      deadline: formatInTimeZone(new Date(targets.cutoff), property.timezone, "h:mm a"),
    });
    await ctx.scheduler.runAfter(0, internal.push.send, { devices, ...text, url: "/home" });
  }
  return devices.length;
}

/**
 * Sends the chosen property's reminder, exactly as residents would get it,
 * to the caller's own phones/browsers, so the Admin can check notifications
 * really arrive. Admin only.
 */
export const sendTest = staffMutation({
  roles: [],
  args: {},
  handler: async (ctx) => {
    const property = oneProperty(ctx.staff);
    const devices = (
      await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", ctx.staff.userId))
        .collect()
    ).map((sub) => ({ subscriptionId: sub._id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }));
    if (devices.length === 0) {
      throw appError("NOT_FOUND", "Turn on notifications on this phone first, then send the test.");
    }
    const now = Date.now();
    const targets = await reminderTargets(ctx, property, now);
    const text = reminderText(property, {
      day: targets === null || !targets.isToday ? "tomorrow" : "today",
      deadline: formatInTimeZone(new Date(targets?.cutoff ?? now), property.timezone, "h:mm a"),
    });
    await ctx.scheduler.runAfter(0, internal.push.send, { devices, ...text, url: "/staff/settings?section=reminders" });
    return { devices: devices.length };
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
