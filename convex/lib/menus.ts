import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { addDays, weekdayOf } from "./time";
import type { MealType } from "./validators";

type DbCtx = Pick<QueryCtx, "db">;
export type MenuLabel = "A" | "B";

/** The Monday of the week containing `date` (weeks run Monday to Sunday). */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** Which menu runs in the week of `date`, given the Monday of a Menu A week. */
export function menuLabelFor(date: string, menuAWeekStart: string): MenuLabel {
  const weeks = Math.round((Date.parse(mondayOf(date)) - Date.parse(mondayOf(menuAWeekStart))) / (7 * 86_400_000));
  return Math.abs(weeks) % 2 === 0 ? "A" : "B";
}

/**
 * Looks up dishes for any date: the menu that week (A or B), that weekday,
 * that meal. Returns null when no rotation is set or nothing is entered.
 * Load once per request and reuse for every date.
 */
export async function loadMenuLookup(ctx: DbCtx, property: Doc<"properties">) {
  const menus = await ctx.db
    .query("menus")
    .withIndex("by_property_label", (q) => q.eq("propertyId", property._id))
    .collect();
  const byLabel = new Map(menus.map((m) => [m.label, m]));
  return (date: string, mealType: MealType): { label: MenuLabel; items: string } | null => {
    if (property.menuAWeekStart === undefined) return null;
    const label = menuLabelFor(date, property.menuAWeekStart);
    const weekday = weekdayOf(date);
    const items = byLabel.get(label)?.entries.find((e) => e.weekday === weekday && e.mealType === mealType)?.items;
    return items ? { label, items } : null;
  };
}
