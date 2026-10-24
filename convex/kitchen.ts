import { v } from "convex/values";
import { formatInTimeZone } from "date-fns-tz";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { toCsv } from "./lib/csv";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";
import { bufferFor, headcountFor, loadRoster, type BufferRule } from "./lib/headcount";
import { isoDateSchema } from "./lib/inputRules";
import { servicesOn } from "./lib/meals";
import { localDateString } from "./lib/time";
import { vBufferRule } from "./lib/validators";

type DbCtx = Pick<QueryCtx, "db">;

const MAX_COUNT = 10_000;
const MAX_WEIGHT_GRAMS = 1_000_000;
const MAX_NOTES = 500;

function parseDate(date: string): string {
  const parsed = isoDateSchema.safeParse(date);
  if (!parsed.success) throw appError("INVALID_INPUT", parsed.error.issues[0]?.message);
  return parsed.data;
}

/** Loads a meal service and confirms it belongs to the staff member's property. */
async function loadOwnService(
  ctx: DbCtx,
  propertyId: Id<"properties">,
  serviceId: Id<"mealServices">,
): Promise<Doc<"mealServices">> {
  const service = await ctx.db.get(serviceId);
  if (service === null || service.propertyId !== propertyId) throw appError("NOT_FOUND");
  return service;
}

async function latestReport(ctx: DbCtx, serviceId: Id<"mealServices">) {
  return await ctx.db
    .query("kitchenReports")
    .withIndex("by_service_version", (q) => q.eq("mealServiceId", serviceId))
    .order("desc")
    .first();
}

async function actualsFor(ctx: DbCtx, serviceId: Id<"mealServices">) {
  return await ctx.db
    .query("actualCounts")
    .withIndex("by_service", (q) => q.eq("mealServiceId", serviceId))
    .unique();
}

async function nameOf(ctx: DbCtx, userId: Id<"users"> | undefined): Promise<string | null> {
  if (userId === undefined) return null;
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", userId))
    .unique();
  return profile?.displayName ?? null;
}

function reportSummary(report: Doc<"kitchenReports"> | null) {
  return (
    report && {
      version: report.version,
      status: report.status,
      bufferApplied: report.bufferApplied,
      bufferRule: report.bufferRule ?? null,
      finalTarget: report.finalTarget,
      finalizedAt: report.finalizedAt ?? null,
    }
  );
}

function actualsSummary(actuals: Doc<"actualCounts"> | null) {
  return (
    actuals && {
      preparedCount: actuals.preparedCount,
      servedCount: actuals.servedCount,
      leftoverCount: actuals.leftoverCount,
      discardedCount: actuals.discardedCount,
      discardedWeightGrams: actuals.discardedWeightGrams ?? null,
      notes: actuals.notes ?? null,
      recordedAt: actuals.recordedAt,
    }
  );
}

/**
 * The staff dashboard for one date: for each meal, the separate counts
 * (eligible / Yes / No / Not answered), the N = Y + O + U check, the
 * kitchen report and the recorded actuals. Counts only, no personal details.
 * Updates live as residents answer.
 */
export const day = staffQuery({
  roles: ["warden", "kitchen"],
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = parseDate(args.date);
    const { property } = ctx.staff;
    const services = await servicesOn(ctx, property._id, date);
    const roster = await loadRoster(ctx, property._id);
    const meals = await Promise.all(
      services.map(async (service) => {
        const { counts } = await headcountFor(ctx, service, roster);
        const report = await latestReport(ctx, service._id);
        return {
          serviceId: service._id,
          mealType: service.mealType,
          name: service.policySnapshot.displayName,
          serviceTime: service.serviceTime,
          cutoffAt: service.cutoffAt,
          cancelled: service.status === "cancelled",
          counts,
          report: reportSummary(report),
          finalizedByName: await nameOf(ctx, report?.finalizedBy),
          actuals: actualsSummary(await actualsFor(ctx, service._id)),
        };
      }),
    );
    return { date, timezone: property.timezone, meals };
  },
});

/**
 * Who hasn't answered, per meal, so the Warden can remind them. Admin and
 * Warden see names and rooms; Kitchen sees room numbers only. Never phones.
 */
export const nonResponders = staffQuery({
  roles: ["warden", "kitchen"],
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = parseDate(args.date);
    const { property, roles } = ctx.staff;
    const showNames = roles.includes("admin") || roles.includes("warden");
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
            cutoffAt: service.cutoffAt,
            eligible: counts.eligible,
            people: nonResponders.map((r) => ({
              residentId: r._id,
              roomNumber: r.roomNumber,
              displayName: showNames ? r.displayName : null,
            })),
          };
        }),
    );
    return { date, timezone: property.timezone, showNames, meals };
  },
});

/** Every version of a meal's kitchen report, newest first. Old versions are never changed. */
export const reportVersions = staffQuery({
  roles: ["warden", "kitchen"],
  args: { mealServiceId: v.id("mealServices") },
  handler: async (ctx, args) => {
    const service = await loadOwnService(ctx, ctx.staff.property._id, args.mealServiceId);
    const reports = await ctx.db
      .query("kitchenReports")
      .withIndex("by_service_version", (q) => q.eq("mealServiceId", service._id))
      .order("desc")
      .collect();
    return await Promise.all(
      reports.map(async (report) => ({
        version: report.version,
        status: report.status,
        eligibleCount: report.eligibleCount,
        confirmedCount: report.confirmedCount,
        optedOutCount: report.optedOutCount,
        nonResponderCount: report.nonResponderCount,
        bufferApplied: report.bufferApplied,
        bufferRule: report.bufferRule ?? null,
        finalTarget: report.finalTarget,
        createdAt: report.createdAt,
        byName: await nameOf(ctx, report.finalizedBy ?? report.createdBy),
      })),
    );
  },
});

function checkBufferRule(rule: BufferRule): void {
  const limit = rule.kind === "fixed" ? 500 : 100;
  if (!Number.isInteger(rule.value) || rule.value < 0 || rule.value > limit) {
    throw appError(
      "INVALID_INPUT",
      rule.kind === "fixed"
        ? "Extra portions must be a whole number from 0 to 500."
        : "The percentage must be a whole number from 0 to 100.",
    );
  }
}

/**
 * Finalizes a meal's cooking target. Recalculates the counts from live
 * data and stores the staff-approved target as a new version. The target
 * sent by the browser must match Yes + buffer on the live counts, so staff
 * never approve a number they didn't see.
 */
export const finalize = staffMutation({
  roles: ["kitchen"],
  args: { mealServiceId: v.id("mealServices"), bufferRule: vBufferRule, finalTarget: v.number() },
  handler: async (ctx, args) => {
    checkBufferRule(args.bufferRule);
    const { property, userId } = ctx.staff;
    const service = await loadOwnService(ctx, property._id, args.mealServiceId);
    if (service.status !== "scheduled") throw appError("INVALID_INPUT", "This meal isn't being served.");
    const now = Date.now();
    if (now < service.cutoffAt) {
      throw appError(
        "CONFLICT",
        `Residents can still change their answers until ${formatInTimeZone(
          new Date(service.cutoffAt),
          property.timezone,
          "h:mm a 'on' EEE d MMM",
        )}. Finalize after that.`,
      );
    }
    const previous = await latestReport(ctx, service._id);
    if (previous?.status === "finalized") {
      throw appError("CONFLICT", "This meal is already finalized. An Admin can reopen it.");
    }
    const { counts } = await headcountFor(ctx, service, await loadRoster(ctx, property._id));
    if (!counts.balanced) {
      throw appError(
        "CONFLICT",
        "The counts don't add up (eligible ≠ Yes + No + Not answered). Please tell the PG Admin.",
      );
    }
    const bufferApplied = bufferFor(args.bufferRule, counts.unanswered);
    const finalTarget = counts.yes + bufferApplied;
    if (args.finalTarget !== finalTarget) {
      throw appError("CONFLICT", "The numbers changed while you were looking. Check the new counts and try again.");
    }
    const version = (previous?.version ?? 0) + 1;
    const reportId = await ctx.db.insert("kitchenReports", {
      organizationId: property.organizationId,
      propertyId: property._id,
      mealServiceId: service._id,
      version,
      confirmedCount: counts.yes,
      optedOutCount: counts.no,
      nonResponderCount: counts.unanswered,
      eligibleCount: counts.eligible,
      bufferApplied,
      bufferRule: args.bufferRule,
      finalTarget,
      status: "finalized",
      createdAt: now,
      createdBy: userId,
      finalizedBy: userId,
      finalizedAt: now,
    });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "report.finalized",
      entityType: "kitchenReports",
      entityId: reportId,
      metadata: {
        serviceDate: service.serviceDate,
        mealType: service.mealType,
        version,
        counts,
        bufferRule: args.bufferRule,
        bufferApplied,
        finalTarget,
      },
    });
    return { version, finalTarget };
  },
});

/**
 * Reopens a finalized report so it can be finalized again. Admin only.
 * Creates a new version; earlier versions stay as they were.
 */
export const reopen = staffMutation({
  roles: [],
  args: { mealServiceId: v.id("mealServices") },
  handler: async (ctx, args) => {
    const { property, userId } = ctx.staff;
    const service = await loadOwnService(ctx, property._id, args.mealServiceId);
    const previous = await latestReport(ctx, service._id);
    if (previous === null || previous.status === "draft") {
      throw appError("CONFLICT", "This meal's report isn't finalized, so there's nothing to reopen.");
    }
    const version = previous.version + 1;
    const reportId = await ctx.db.insert("kitchenReports", {
      organizationId: property.organizationId,
      propertyId: property._id,
      mealServiceId: service._id,
      version,
      confirmedCount: previous.confirmedCount,
      optedOutCount: previous.optedOutCount,
      nonResponderCount: previous.nonResponderCount,
      eligibleCount: previous.eligibleCount,
      bufferApplied: previous.bufferApplied,
      bufferRule: previous.bufferRule,
      finalTarget: previous.finalTarget,
      status: "draft",
      createdAt: Date.now(),
      createdBy: userId,
    });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "report.reopened",
      entityType: "kitchenReports",
      entityId: reportId,
      metadata: { serviceDate: service.serviceDate, mealType: service.mealType, version, reopenedVersion: previous.version },
    });
    return { version };
  },
});

function checkCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT) {
    throw appError("INVALID_INPUT", `${label} must be a whole number from 0 to ${MAX_COUNT}.`);
  }
}

/**
 * Records what was actually prepared, served, kept as leftovers and thrown
 * away. One record per meal; changes are audited with the old values.
 */
export const recordActuals = staffMutation({
  roles: ["kitchen"],
  args: {
    mealServiceId: v.id("mealServices"),
    preparedCount: v.number(),
    servedCount: v.number(),
    leftoverCount: v.number(),
    discardedCount: v.number(),
    discardedWeightGrams: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    checkCount(args.preparedCount, "Prepared");
    checkCount(args.servedCount, "Served");
    checkCount(args.leftoverCount, "Leftover");
    checkCount(args.discardedCount, "Discarded");
    if (args.servedCount > args.preparedCount) {
      throw appError("INVALID_INPUT", "Served can't be more than prepared.");
    }
    if (args.leftoverCount + args.discardedCount > args.preparedCount - args.servedCount) {
      throw appError(
        "INVALID_INPUT",
        "Leftover plus discarded can't be more than what wasn't served (prepared minus served).",
      );
    }
    const weight = args.discardedWeightGrams;
    if (weight !== undefined && (!Number.isFinite(weight) || weight < 0 || weight > MAX_WEIGHT_GRAMS)) {
      throw appError("INVALID_INPUT", "Discarded weight must be between 0 and 1,000,000 grams.");
    }
    const notes = args.notes?.trim() || undefined;
    if (notes !== undefined && notes.length > MAX_NOTES) {
      throw appError("INVALID_INPUT", `Notes can be at most ${MAX_NOTES} characters.`);
    }

    const { property, userId } = ctx.staff;
    const service = await loadOwnService(ctx, property._id, args.mealServiceId);
    if (service.serviceDate > localDateString(Date.now(), property.timezone)) {
      throw appError("INVALID_INPUT", "You can record actuals on the day of the meal or later.");
    }
    const values = {
      preparedCount: args.preparedCount,
      servedCount: args.servedCount,
      leftoverCount: args.leftoverCount,
      discardedCount: args.discardedCount,
      discardedWeightGrams: weight,
      notes,
      recordedBy: userId,
      recordedAt: Date.now(),
    };
    const existing = await actualsFor(ctx, service._id);
    let actualsId: Id<"actualCounts">;
    if (existing === null) {
      actualsId = await ctx.db.insert("actualCounts", {
        organizationId: property.organizationId,
        propertyId: property._id,
        mealServiceId: service._id,
        ...values,
      });
    } else {
      actualsId = existing._id;
      await ctx.db.replace(existing._id, {
        organizationId: existing.organizationId,
        propertyId: existing.propertyId,
        mealServiceId: existing.mealServiceId,
        ...values,
      });
    }
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "actuals.recorded",
      entityType: "actualCounts",
      entityId: actualsId,
      metadata: {
        serviceDate: service.serviceDate,
        mealType: service.mealType,
        previous: existing && { ...actualsSummary(existing), recordedAt: existing.recordedAt },
        recorded: {
          preparedCount: values.preparedCount,
          servedCount: values.servedCount,
          leftoverCount: values.leftoverCount,
          discardedCount: values.discardedCount,
          discardedWeightGrams: weight ?? null,
          notes: notes ?? null,
        },
      },
    });
    return null;
  },
});

const STATUS_TEXT = { draft: "Reopened", finalized: "Finalized", needs_review: "Needs review" } as const;

/**
 * The kitchen report for one date as a CSV file, built on the server.
 * Every export is recorded in the audit log.
 */
export const exportDayCsv = staffMutation({
  roles: ["warden", "kitchen"],
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const date = parseDate(args.date);
    const { property, userId } = ctx.staff;
    const tz = property.timezone;
    const local = (ms: number | undefined) =>
      ms === undefined ? "" : formatInTimeZone(new Date(ms), tz, "yyyy-MM-dd HH:mm");
    const services = await servicesOn(ctx, property._id, date);
    const roster = await loadRoster(ctx, property._id);
    const rows: (string | number | null)[][] = [
      [
        "Date",
        "Meal",
        "Service time",
        `Cutoff (${tz})`,
        "Eligible (N)",
        "Yes (Y)",
        "No (O)",
        "Not answered (U)",
        "N = Y + O + U",
        "Report status",
        "Report version",
        "Buffer",
        "Final target",
        "Finalized by",
        `Finalized at (${tz})`,
        "Prepared",
        "Served",
        "Unserved (prepared - served)",
        "Leftover",
        "Discarded",
        "Discarded weight (g, measured)",
        "Notes",
      ],
    ];
    for (const service of services) {
      const { counts } = await headcountFor(ctx, service, roster);
      const report = await latestReport(ctx, service._id);
      const actuals = await actualsFor(ctx, service._id);
      rows.push([
        service.serviceDate,
        service.policySnapshot.displayName + (service.status === "cancelled" ? " (not served)" : ""),
        service.serviceTime,
        local(service.cutoffAt),
        counts.eligible,
        counts.yes,
        counts.no,
        counts.unanswered,
        counts.balanced ? "OK" : "DOES NOT ADD UP",
        report ? STATUS_TEXT[report.status] : "Not finalized",
        report?.version ?? null,
        report?.bufferApplied ?? null,
        report?.finalTarget ?? null,
        await nameOf(ctx, report?.finalizedBy),
        local(report?.finalizedAt),
        actuals?.preparedCount ?? null,
        actuals?.servedCount ?? null,
        actuals ? actuals.preparedCount - actuals.servedCount : null,
        actuals?.leftoverCount ?? null,
        actuals?.discardedCount ?? null,
        actuals?.discardedWeightGrams ?? null,
        actuals?.notes ?? null,
      ]);
    }
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "export.kitchen_csv",
      entityType: "properties",
      entityId: property._id,
      metadata: { date, meals: services.length },
    });
    return { filename: `mealsync-kitchen-${date}.csv`, csv: toCsv(rows) };
  },
});
