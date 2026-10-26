import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ineligibilityOn } from "./meals";

type DbCtx = Pick<QueryCtx, "db">;

/**
 * Everyone who could be counted on `date`: active residents, plus their
 * approved leaves. Load once per date and reuse for each meal that day.
 */
export async function loadRoster(ctx: DbCtx, propertyId: Id<"properties">) {
  const residents = await ctx.db
    .query("residents")
    .withIndex("by_property_status", (q) => q.eq("propertyId", propertyId).eq("status", "active"))
    .collect();
  const leaves = await ctx.db
    .query("leaves")
    .withIndex("by_property_status", (q) => q.eq("propertyId", propertyId).eq("status", "approved"))
    .collect();
  const leavesByResident = new Map<Id<"residents">, Doc<"leaves">[]>();
  for (const leave of leaves) {
    leavesByResident.set(leave.residentId, [...(leavesByResident.get(leave.residentId) ?? []), leave]);
  }
  return { residents, leavesByResident };
}

export type Roster = Awaited<ReturnType<typeof loadRoster>>;

export type Headcount = {
  /** N: residents eligible for this meal. */
  eligible: number;
  /** Y: eligible residents who said Yes. */
  yes: number;
  /** O: eligible residents who said No. */
  no: number;
  /** U: eligible residents with no answer. Never assumed to be No. */
  unanswered: number;
  /** Whether N = Y + O + U. If not, something is wrong and must be shown, not hidden. */
  balanced: boolean;
  /** Answers from people not counted that day (e.g. on leave since answering). Shown separately. */
  notCounted: number;
};

/**
 * Counts for one meal service, from live data. N comes from the roster;
 * Y and O from the saved answers of eligible residents; U from eligible
 * residents with no saved answer. The three are computed independently so
 * the N = Y + O + U check means something.
 */
export async function headcountFor(
  ctx: DbCtx,
  service: Doc<"mealServices">,
  roster: Roster,
): Promise<{ counts: Headcount; nonResponders: Doc<"residents">[] }> {
  const eligible = roster.residents.filter(
    (r) => ineligibilityOn(r, roster.leavesByResident.get(r._id) ?? [], service.serviceDate) === null,
  );
  const eligibleIds = new Set(eligible.map((r) => r._id));
  const responses = await ctx.db
    .query("mealResponses")
    .withIndex("by_service", (q) => q.eq("mealServiceId", service._id))
    .collect();

  let yes = 0;
  let no = 0;
  let notCounted = 0;
  const answered = new Set<Id<"residents">>();
  for (const response of responses) {
    if (!eligibleIds.has(response.residentId)) {
      notCounted += 1;
      continue;
    }
    answered.add(response.residentId);
    if (response.selection === "yes") yes += 1;
    else no += 1;
  }
  const nonResponders = eligible
    .filter((r) => !answered.has(r._id))
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  const unanswered = nonResponders.length;
  return {
    counts: {
      eligible: eligible.length,
      yes,
      no,
      unanswered,
      balanced: eligible.length === yes + no + unanswered,
      notCounted,
    },
    nonResponders,
  };
}
