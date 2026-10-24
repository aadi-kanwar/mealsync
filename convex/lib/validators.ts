import { v, type Infer } from "convex/values";

export const vRecordStatus = v.union(v.literal("active"), v.literal("inactive"));

export const STAFF_ROLES = ["admin", "warden", "kitchen"] as const;
export const vStaffRole = v.union(
  v.literal("admin"),
  v.literal("warden"),
  v.literal("kitchen"),
);
export type StaffRole = Infer<typeof vStaffRole>;

export const vResidentStatus = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("rejected"),
  v.literal("inactive"),
);
export type ResidentStatus = Infer<typeof vResidentStatus>;

export const MEAL_TYPES = ["breakfast", "lunch", "snacks", "dinner"] as const;
export const vMealType = v.union(
  v.literal("breakfast"),
  v.literal("lunch"),
  v.literal("snacks"),
  v.literal("dinner"),
);
export type MealType = Infer<typeof vMealType>;

/** "Cut off N days before the service date, at HH:mm property-local time." */
export const vCutoffRule = v.object({
  daysBefore: v.number(),
  time: v.string(), // "HH:mm"
});
export type CutoffRule = Infer<typeof vCutoffRule>;

/** The slot settings a meal service was created from, frozen at creation. */
export const vSlotPolicySnapshot = v.object({
  displayName: v.string(),
  serviceTime: v.string(),
  cutoffRule: vCutoffRule,
  timezone: v.string(),
});

export const vMealServiceStatus = v.union(
  v.literal("scheduled"),
  v.literal("cancelled"),
);

export const vSelection = v.union(v.literal("yes"), v.literal("no"));
export type Selection = Infer<typeof vSelection>;

export const vPreviousSelection = v.union(
  v.literal("yes"),
  v.literal("no"),
  v.literal("none"),
);

export const vActorRole = v.union(
  v.literal("resident"),
  v.literal("admin"),
  v.literal("warden"),
);

export const vLeaveStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

export const vKitchenReportStatus = v.union(
  v.literal("draft"),
  v.literal("finalized"),
  v.literal("needs_review"),
);

/** "+N portions" or "+N% of non-responders", added on top of the Yes count. */
export const vBufferRule = v.object({
  kind: v.union(v.literal("fixed"), v.literal("percent_of_unanswered")),
  value: v.number(),
});
