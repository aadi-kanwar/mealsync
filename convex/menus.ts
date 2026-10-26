import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";
import { menuLabelFor, mondayOf } from "./lib/menus";
import { addDays, localDateString } from "./lib/time";
import { MEAL_TYPES, vMealType } from "./lib/validators";

const MAX_ITEMS_LENGTH = 200;
const vLabel = v.union(v.literal("A"), v.literal("B"));

/** Both weekly menus, and which one runs this week and next. Admin only. */
export const get = staffQuery({
  roles: [],
  args: {},
  handler: async (ctx) => {
    const { property } = ctx.staff;
    const menus = await ctx.db
      .query("menus")
      .withIndex("by_property_label", (q) => q.eq("propertyId", property._id))
      .collect();
    const today = localDateString(Date.now(), property.timezone);
    const thisWeek = mondayOf(today);
    const start = property.menuAWeekStart;
    return {
      thisWeekStart: thisWeek,
      thisWeek: start === undefined ? null : menuLabelFor(thisWeek, start),
      nextWeek: start === undefined ? null : menuLabelFor(addDays(thisWeek, 7), start),
      menus: (["A", "B"] as const).map((label) => {
        const menu = menus.find((m) => m.label === label);
        return { label, entries: menu?.entries ?? [], updatedAt: menu?.updatedAt ?? null };
      }),
    };
  },
});

/** Saves one weekly menu (all 7 days x 4 meals). Empty boxes are allowed. Admin only. */
export const save = staffMutation({
  roles: [],
  args: {
    label: vLabel,
    entries: v.array(v.object({ weekday: v.number(), mealType: vMealType, items: v.string() })),
  },
  handler: async (ctx, args) => {
    const seen = new Set<string>();
    const entries = [];
    for (const entry of args.entries) {
      if (!Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6) {
        throw appError("INVALID_INPUT", "Unknown day of the week.");
      }
      const key = `${entry.weekday}:${entry.mealType}`;
      if (seen.has(key)) throw appError("INVALID_INPUT", "The same day and meal appears twice.");
      seen.add(key);
      const items = entry.items.trim().replace(/\s+/g, " ");
      if (items.length > MAX_ITEMS_LENGTH) {
        throw appError("INVALID_INPUT", `Keep each meal's dishes under ${MAX_ITEMS_LENGTH} characters.`);
      }
      if (items !== "") entries.push({ weekday: entry.weekday, mealType: entry.mealType, items });
    }
    entries.sort((a, b) => a.weekday - b.weekday || MEAL_TYPES.indexOf(a.mealType) - MEAL_TYPES.indexOf(b.mealType));

    const { property, userId } = ctx.staff;
    const existing = await ctx.db
      .query("menus")
      .withIndex("by_property_label", (q) => q.eq("propertyId", property._id).eq("label", args.label))
      .unique();
    const now = Date.now();
    if (existing === null) {
      await ctx.db.insert("menus", {
        organizationId: property.organizationId,
        propertyId: property._id,
        label: args.label,
        entries,
        updatedAt: now,
        updatedBy: userId,
      });
    } else {
      await ctx.db.patch(existing._id, { entries, updatedAt: now, updatedBy: userId });
    }
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "menu.updated",
      entityType: "menus",
      entityId: args.label,
      metadata: { label: args.label, filled: entries.length },
    });
    return null;
  },
});

/** Sets which menu runs this week; the weeks after alternate automatically. Admin only. */
export const setThisWeek = staffMutation({
  roles: [],
  args: { label: vLabel },
  handler: async (ctx, args) => {
    const { property, userId } = ctx.staff;
    const thisWeek = mondayOf(localDateString(Date.now(), property.timezone));
    const menuAWeekStart = args.label === "A" ? thisWeek : addDays(thisWeek, 7);
    await ctx.db.patch(property._id, { menuAWeekStart });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "menu.rotation_set",
      entityType: "properties",
      entityId: property._id,
      metadata: { thisWeek, thisWeekMenu: args.label },
    });
    return null;
  },
});
