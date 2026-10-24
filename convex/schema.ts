import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vActorRole,
  vCutoffRule,
  vKitchenReportStatus,
  vLeaveStatus,
  vMealServiceStatus,
  vMealType,
  vPreviousSelection,
  vRecordStatus,
  vResidentStatus,
  vSelection,
  vSlotPolicySnapshot,
  vStaffRole,
} from "./lib/validators";

/**
 * MealSync data model.
 *
 * Convex has no unique constraints. Every "one per X" rule written below is
 * enforced inside the mutation that inserts the row (look up by index first,
 * then insert or update). Mutations are transactional, so this is safe.
 *
 * Every property-scoped table carries both `organizationId` and `propertyId`
 * so the app can grow to multiple PGs later without a rewrite.
 */
export default defineSchema({
  // Tables required by Convex Auth (users, sessions, accounts, ...).
  ...authTables,

  organizations: defineTable({
    name: v.string(),
    slug: v.string(), // unique
    status: vRecordStatus,
  }).index("by_slug", ["slug"]),

  properties: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    slug: v.string(), // unique within organization
    timezone: v.string(), // IANA, e.g. "Asia/Kolkata"
    status: vRecordStatus,
    reminderSettings: v.object({
      // Show the in-app "cutoff is near" banner this many minutes before cutoff.
      bannerMinutesBeforeCutoff: v.number(),
    }),
  })
    .index("by_status", ["status"])
    .index("by_org_slug", ["organizationId", "slug"]),

  // One per signed-in person. Not property-scoped: a person may later belong
  // to several properties through `residents` and `staffRoles`.
  userProfiles: defineTable({
    authUserId: v.id("users"), // unique
    displayName: v.string(),
    phone: v.string(), // E.164, unique
    status: vRecordStatus,
    createdAt: v.number(),
  })
    .index("by_authUserId", ["authUserId"])
    .index("by_phone", ["phone"]),

  staffRoles: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    userId: v.id("users"),
    role: vStaffRole, // one active row per property + user + role
    status: vRecordStatus,
    grantedBy: v.optional(v.id("users")), // absent only for the first-admin setup step
    grantedAt: v.number(),
    revokedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
  })
    .index("by_property_user", ["propertyId", "userId"])
    .index("by_property_role_status", ["propertyId", "role", "status"])
    .index("by_property_status", ["propertyId", "status"]),

  residents: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    userId: v.id("users"), // one record per property + user
    displayName: v.string(),
    roomNumber: v.string(),
    validFrom: v.optional(v.string()), // property-local YYYY-MM-DD, set on approval
    validUntil: v.optional(v.string()), // property-local YYYY-MM-DD, set on checkout
    status: vResidentStatus,
    createdAt: v.number(),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    rejectedBy: v.optional(v.id("users")),
    rejectedAt: v.optional(v.number()),
  })
    .index("by_property_user", ["propertyId", "userId"])
    .index("by_property_status", ["propertyId", "status"])
    .index("by_user", ["userId"]),

  mealSlots: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    mealType: vMealType,
    displayName: v.string(),
    serviceTime: v.string(), // "HH:mm", property-local
    cutoffRule: vCutoffRule,
    serviceDays: v.array(v.number()), // 0 = Sunday ... 6 = Saturday
    sortOrder: v.number(),
    active: v.boolean(),
    effectiveFrom: v.string(), // YYYY-MM-DD
    effectiveUntil: v.optional(v.string()), // YYYY-MM-DD
  })
    .index("by_property", ["propertyId"])
    .index("by_property_mealType", ["propertyId", "mealType"]),

  mealServices: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    serviceDate: v.string(), // property-local YYYY-MM-DD
    mealType: vMealType, // one per property + date + mealType
    mealSlotId: v.id("mealSlots"),
    serviceTime: v.string(),
    cutoffAt: v.number(), // UTC epoch ms, frozen at creation
    status: vMealServiceStatus,
    policySnapshot: vSlotPolicySnapshot,
    createdAt: v.number(),
  })
    .index("by_property_date_meal", ["propertyId", "serviceDate", "mealType"])
    .index("by_property_date", ["propertyId", "serviceDate"]),

  // Current choice only. One per service + resident.
  mealResponses: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    mealServiceId: v.id("mealServices"),
    residentId: v.id("residents"),
    selection: vSelection,
    version: v.number(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  })
    .index("by_service_resident", ["mealServiceId", "residentId"])
    .index("by_service", ["mealServiceId"])
    .index("by_resident", ["residentId"]),

  // Append-only permanent record of every meal choice change.
  // No function may patch, replace or delete rows in this table.
  mealActivityLog: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    mealServiceId: v.id("mealServices"),
    residentId: v.id("residents"),
    residentName: v.string(),
    roomNumber: v.string(), // at the time of the change
    serviceDate: v.string(),
    mealType: vMealType,
    mealDisplayName: v.string(),
    previousSelection: vPreviousSelection,
    newSelection: vSelection,
    afterCutoff: v.boolean(),
    actorUserId: v.id("users"),
    actorName: v.string(),
    actorRole: vActorRole,
    source: v.union(v.literal("resident_app"), v.literal("staff_correction")),
    reason: v.optional(v.string()),
    responseVersion: v.number(),
    createdAt: v.number(),
  })
    .index("by_property_createdAt", ["propertyId", "createdAt"])
    .index("by_property_serviceDate", ["propertyId", "serviceDate"])
    .index("by_resident_createdAt", ["residentId", "createdAt"]),

  leaves: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    residentId: v.id("residents"),
    startDate: v.string(), // inclusive, property-local
    endDate: v.string(), // inclusive, property-local
    status: vLeaveStatus,
    requestedBy: v.id("users"),
    createdAt: v.number(),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
  })
    .index("by_resident", ["residentId"])
    .index("by_property_status", ["propertyId", "status"]),

  // Each finalization or reopen creates a new version. Old versions stay.
  kitchenReports: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    mealServiceId: v.id("mealServices"),
    version: v.number(),
    confirmedCount: v.number(),
    optedOutCount: v.number(),
    nonResponderCount: v.number(),
    eligibleCount: v.number(),
    bufferApplied: v.number(),
    finalTarget: v.number(),
    status: vKitchenReportStatus,
    createdAt: v.number(),
    finalizedBy: v.optional(v.id("users")),
    finalizedAt: v.optional(v.number()),
  }).index("by_service_version", ["mealServiceId", "version"]),

  actualCounts: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    mealServiceId: v.id("mealServices"),
    preparedCount: v.number(),
    servedCount: v.number(),
    leftoverCount: v.number(),
    discardedCount: v.number(),
    discardedWeightGrams: v.optional(v.number()),
    notes: v.optional(v.string()),
    recordedBy: v.id("users"),
    recordedAt: v.number(),
  }).index("by_service", ["mealServiceId"]),

  // Replaces the master prompt's `otpRateLimits`: login is phone + password,
  // so we limit failed sign-in attempts per phone number (whether or not the
  // number is registered) and the overall rate of new sign-ups.
  authAttemptLimits: defineTable({
    key: v.string(), // e.g. "fail:+919876543210" or "signup:global"
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Non-meal actions: approvals, role grants, settings changes, exports...
  // Never store passwords, tokens or other secrets here.
  auditLogs: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    actorUserId: v.optional(v.id("users")), // absent for setup steps run by the owner from the Convex dashboard
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_property_createdAt", ["propertyId", "createdAt"])
    .index("by_entity", ["entityType", "entityId"]),
});
