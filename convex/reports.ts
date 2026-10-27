import { v } from "convex/values";
import { formatInTimeZone } from "date-fns-tz";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { toCsv } from "./lib/csv";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";
import { isoDateSchema } from "./lib/inputRules";
import { approvedLeavesOf, ineligibilityOn, servicesOn } from "./lib/meals";
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

type ResidentRow = {
  date: string;
  mealType: Doc<"mealServices">["mealType"];
  meal: string;
  /** Why this meal doesn't count for them, or null if it does. */
  notCounted: "cancelled" | "on_leave" | "not_living_here" | null;
  choice: "yes" | "no" | null;
  savedAt: number | null;
};

/** One resident's choice for every meal on each day in the range. */
async function buildResidentReport(
  ctx: Pick<QueryCtx, "db">,
  property: Doc<"properties">,
  resident: Doc<"residents">,
  from: string,
  to: string,
) {
  const leaves = await approvedLeavesOf(ctx, resident._id);
  // Status is checked by date range below, so moved-out residents keep their history.
  const asActive = { ...resident, status: "active" as const };
  const rows: ResidentRow[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const why = ineligibilityOn(asActive, leaves, date);
    for (const service of await servicesOn(ctx, property._id, date)) {
      const response = await ctx.db
        .query("mealResponses")
        .withIndex("by_service_resident", (q) => q.eq("mealServiceId", service._id).eq("residentId", resident._id))
        .unique();
      rows.push({
        date,
        mealType: service.mealType,
        meal: service.policySnapshot.displayName,
        notCounted:
          service.status === "cancelled" ? "cancelled" : why === "on_leave" ? "on_leave" : why === null ? null : "not_living_here",
        choice: response?.selection ?? null,
        savedAt: response?.updatedAt ?? null,
      });
    }
  }
  return rows;
}

function summariseResident(rows: ResidentRow[]) {
  return summarise(
    rows.map((r) => ({
      date: r.date,
      mealType: r.mealType,
      meal: r.meal,
      cancelled: r.notCounted !== null,
      counted: 1,
      yes: r.choice === "yes" ? 1 : 0,
      no: r.choice === "no" ? 1 : 0,
      unanswered: r.choice === null ? 1 : 0,
    })),
  );
}

const NOT_COUNTED = { cancelled: "Meal cancelled", on_leave: "On leave", not_living_here: "Not living here" } as const;
const CHOICE = { yes: "Yes", no: "No" } as const;

async function loadReportResident(ctx: Pick<QueryCtx, "db">, propertyId: Doc<"properties">["_id"], residentId: Doc<"residents">["_id"]) {
  const resident = await ctx.db.get(residentId);
  if (resident === null || resident.propertyId !== propertyId || (resident.status !== "active" && resident.status !== "inactive")) {
    throw appError("NOT_FOUND", "That resident wasn't found.");
  }
  return resident;
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
  args: { from: v.string(), to: v.string(), residentId: v.optional(v.id("residents")) },
  handler: async (ctx, args) => {
    const { from, to } = parseRange(args.from, args.to);
    const { property } = ctx.staff;
    if (args.residentId !== undefined) {
      const resident = await loadReportResident(ctx, property._id, args.residentId);
      const rows = await buildResidentReport(ctx, property, resident, from, to);
      return { from, to, days: new Set(rows.map((r) => r.date)).size, meals: summariseResident(rows) };
    }
    const rows = await buildReport(ctx, property, from, to);
    return { from, to, days: new Set(rows.map((r) => r.date)).size, meals: summarise(rows) };
  },
});

/**
 * The report as a CSV file (one row per meal per day), for everyone or for
 * one resident. Admin only; each download is audited.
 */
export const exportCsv = staffMutation({
  roles: [],
  args: { from: v.string(), to: v.string(), residentId: v.optional(v.id("residents")) },
  handler: async (ctx, args) => {
    const { from, to } = parseRange(args.from, args.to);
    const { property, userId } = ctx.staff;
    if (args.residentId !== undefined) {
      const resident = await loadReportResident(ctx, property._id, args.residentId);
      const rows = await buildResidentReport(ctx, property, resident, from, to);
      const csv = toCsv([
        ["Resident", "Room", "Date", "Day", "Meal", "Choice", "Last saved"],
        ...rows.map((r) => [
          resident.displayName,
          resident.roomNumber,
          r.date,
          WEEKDAYS[weekdayOf(r.date)],
          r.meal,
          r.notCounted !== null ? NOT_COUNTED[r.notCounted] : r.choice === null ? "Not answered" : CHOICE[r.choice],
          r.savedAt === null ? "" : formatInTimeZone(new Date(r.savedAt), property.timezone, "yyyy-MM-dd HH:mm"),
        ]),
      ]);
      await writeAudit(ctx, {
        property,
        actorUserId: userId,
        action: "report.exported",
        entityType: "residents",
        entityId: resident._id,
        metadata: { from, to, rows: rows.length },
      });
      const slug = resident.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resident";
      return { filename: `dine-${slug}-${from}-to-${to}.csv`, csv };
    }
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

/** Everyone who has lived here (current and moved out), to pick for a resident report. Admin only. */
export const residents = staffQuery({
  roles: [],
  args: {},
  handler: async (ctx) => {
    const { property } = ctx.staff;
    const all = [];
    for (const status of ["active", "inactive"] as const) {
      all.push(
        ...(await ctx.db
          .query("residents")
          .withIndex("by_property_status", (q) => q.eq("propertyId", property._id).eq("status", status))
          .collect()),
      );
    }
    return all
      .map((r) => ({ residentId: r._id, displayName: r.displayName, roomNumber: r.roomNumber, movedOut: r.status === "inactive" }))
      .sort((a, b) => Number(a.movedOut) - Number(b.movedOut) || a.displayName.localeCompare(b.displayName));
  },
});
