import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { toCsv } from "./lib/csv";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";
import { isoDateSchema } from "./lib/inputRules";
import { servicesOn } from "./lib/meals";
import { addDays, weekdayOf } from "./lib/time";

/** Longest range one report covers, in days. */
export const MAX_REPORT_DAYS = 100;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseRange(from: string, to: string) {
  const a = isoDateSchema.safeParse(from);
  const b = isoDateSchema.safeParse(to);
  if (!a.success || !b.success) throw appError("INVALID_INPUT", "Choose a start and an end date.");
  if (b.data < a.data) throw appError("INVALID_INPUT", "The end date must be on or after the start date.");
  if (addDays(a.data, MAX_REPORT_DAYS - 1) < b.data) {
    throw appError("INVALID_INPUT", `A report can cover at most ${MAX_REPORT_DAYS} days.`);
  }
  return { from: a.data, to: b.data };
}

export type ReportRow = {
  date: string;
  mealType: Doc<"mealServices">["mealType"];
  meal: string;
  cancelled: boolean;
  counted: number;
  yes: number;
  no: number;
  unanswered: number;
};

/**
 * One row per meal per day: residents counted that day (moved-out residents
 * included for the days they lived here; on leave excluded), and how many
 * said Yes, No, or didn't answer.
 */
async function buildReport(ctx: Pick<QueryCtx, "db">, property: Doc<"properties">, from: string, to: string) {
  const residents = [
    ...(await ctx.db
      .query("residents")
      .withIndex("by_property_status", (q) => q.eq("propertyId", property._id).eq("status", "active"))
      .collect()),
    ...(await ctx.db
      .query("residents")
      .withIndex("by_property_status", (q) => q.eq("propertyId", property._id).eq("status", "inactive"))
      .collect()),
  ];
  const leaves = await ctx.db
    .query("leaves")
    .withIndex("by_property_status", (q) => q.eq("propertyId", property._id).eq("status", "approved"))
    .collect();
  const countedOn = (date: string) =>
    new Set(
      residents
        .filter(
          (r) =>
            r.validFrom !== undefined &&
            r.validFrom <= date &&
            (r.validUntil === undefined || date <= r.validUntil) &&
            !leaves.some((l) => l.residentId === r._id && l.startDate <= date && date <= l.endDate),
        )
        .map((r) => r._id),
    );

  const rows: ReportRow[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const counted = countedOn(date);
    for (const service of await servicesOn(ctx, property._id, date)) {
      const cancelled = service.status === "cancelled";
      let yes = 0;
      let no = 0;
      if (!cancelled) {
        for (const r of await ctx.db
          .query("mealResponses")
          .withIndex("by_service", (q) => q.eq("mealServiceId", service._id))
          .collect()) {
          if (!counted.has(r.residentId)) continue;
          if (r.selection === "yes") yes += 1;
          else no += 1;
        }
      }
      rows.push({
        date,
        mealType: service.mealType,
        meal: service.policySnapshot.displayName,
        cancelled,
        counted: cancelled ? 0 : counted.size,
        yes,
        no,
        unanswered: cancelled ? 0 : counted.size - yes - no,
      });
    }
  }
  return rows;
}

function summarise(rows: ReportRow[]) {
  const meals = new Map<string, { mealType: string; meal: string; days: number; yes: number; no: number; unanswered: number }>();
  for (const row of rows) {
    if (row.cancelled) continue;
    const m = meals.get(row.mealType) ?? { mealType: row.mealType, meal: row.meal, days: 0, yes: 0, no: 0, unanswered: 0 };
    m.days += 1;
    m.yes += row.yes;
    m.no += row.no;
    m.unanswered += row.unanswered;
    meals.set(row.mealType, m);
  }
  return [...meals.values()];
}

const percent = (part: number, whole: number) => (whole === 0 ? "" : `${Math.round((part / whole) * 100)}%`);

/** Totals per meal for the chosen dates, to preview before downloading. Admin only. */
export const summary = staffQuery({
  roles: [],
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const { from, to } = parseRange(args.from, args.to);
    const rows = await buildReport(ctx, ctx.staff.property, from, to);
    return { from, to, days: new Set(rows.map((r) => r.date)).size, meals: summarise(rows) };
  },
});

/** The report as a CSV file (one row per meal per day). Admin only; each download is audited. */
export const exportCsv = staffMutation({
  roles: [],
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const { from, to } = parseRange(args.from, args.to);
    const { property, userId } = ctx.staff;
    const rows = await buildReport(ctx, property, from, to);
    const csv = toCsv([
      ["Date", "Day", "Meal", "Status", "Residents counted", "Yes", "No", "Not answered", "Answered"],
      ...rows.map((r) => [
        r.date,
        WEEKDAYS[weekdayOf(r.date)],
        r.meal,
        r.cancelled ? "Cancelled" : "Served",
        r.counted,
        r.yes,
        r.no,
        r.unanswered,
        percent(r.yes + r.no, r.counted),
      ]),
    ]);
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "report.exported",
      entityType: "properties",
      entityId: property._id,
      metadata: { from, to, rows: rows.length },
    });
    return { filename: `dine-report-${from}-to-${to}.csv`, csv };
  },
});
