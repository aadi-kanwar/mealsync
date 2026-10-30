import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vActorRole,
  vCutoffRule,
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
 * Dine data model.
 *
 * Convex has no unique constraints. Every "one per X" rule written below is
 * enforced inside the mutation that inserts the row (look up by index first,
 * then insert or update). Mutations are transactional, so this is safe.
 *
 * An organisation (one per Admin who creates it) has one or more properties
 * (PGs). Every property-scoped table carries both `organizationId` and
 * `propertyId`.
 */
export default defineSchema({
  // Tables required by Convex Auth (users, sessions, accounts, ...).
  ...authTables,

  organizations: defineTable({
    name: v.string(),
    slug: v.string(), // unique
    status: vRecordStatus,
    createdBy: v.optional(v.id("users")), // the Admin who created it (absent for the first, set up by the owner)
    createdAt: v.optional(v.number()),
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
    // Two weekly menus alternate: the week starting on this Monday (and every
    // second week from it) uses Menu A; the weeks in between use Menu B.
    menuAWeekStart: v.optional(v.string()),
    // Shown to residents above their meals: the question of the day (the
    // list takes turns, one per day) and the message about food waste.
    // Absent until the Admin edits them; the app then uses its defaults.
    dailyQuestions: v.optional(v.array(v.string())),
    wasteMessage: v.optional(v.string()),
    // Phone reminders to residents who haven't answered: on/off and the
    // property-local times ("HH:mm") they go out. Absent: defaults apply.
    remindersEnabled: v.optional(v.boolean()),
    reminderTimes: v.optional(v.array(v.string())),
  })
    .index("by_status", ["status"])
    .index("by_org_slug", ["organizationId", "slug"])
    .index("by_org_status", ["organizationId", "status"]),

  // One per signed-in person. Not property-scoped: a person may later belong
  // to several properties through `residents` and `staffRoles`.
  userProfiles: defineTable({
    authUserId: v.id("users"), // unique
    displayName: v.string(),
    phone: v.string(), // E.164, unique
    status: vRecordStatus,
    createdAt: v.number(),
    // Set when staff reset the password; the person must choose a new one.
    mustChangePassword: v.optional(v.boolean()),
  })
    .index("by_authUserId", ["authUserId"])
    .index("by_phone", ["phone"]),

  // A person is staff of one organisation at most. Admin rows are
  // organisation-wide (no propertyId; older rows may still carry one, which
  // is ignored). Warden rows: one per property they're assigned to.
  staffRoles: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.optional(v.id("properties")),
    userId: v.id("users"),
    role: vStaffRole, // one active row per (property) + user + role
    status: vRecordStatus,
    grantedBy: v.optional(v.id("users")), // absent only for the first-admin setup step
    grantedAt: v.number(),
    revokedBy: v.optional(v.id("users")),
    revokedAt: v.optional(v.number()),
  })
    .index("by_property_user", ["propertyId", "userId"])
    .index("by_property_role_status", ["propertyId", "role", "status"])
    .index("by_property_status", ["propertyId", "status"])
    .index("by_user_status", ["userId", "status"])
    .index("by_org_status", ["organizationId", "status"]),

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
    serviceTime: v.string(), // "HH:mm", property-local: when the meal starts
    endTime: v.string(), // "HH:mm": when it ends
    cutoffRule: vCutoffRule,
    serviceDays: v.array(v.number()), // 0 = Sunday ... 6 = Saturday
    sortOrder: v.number(),
    active: v.boolean(),
    effectiveFrom: v.string(), // YYYY-MM-DD
    effectiveUntil: v.optional(v.string()), // YYYY-MM-DD
  })
    .index("by_property", ["propertyId"])
    .index("by_property_mealType", ["propertyId", "mealType"]),

  // The two weekly menus (A and B). One row per menu; `entries` has the
  // dishes for each weekday and meal. One per property + label.
  menus: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    label: v.union(v.literal("A"), v.literal("B")),
    entries: v.array(
      v.object({
        weekday: v.number(), // 0 = Sunday ... 6 = Saturday
        mealType: vMealType,
        items: v.string(),
      }),
    ),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  }).index("by_property_label", ["propertyId", "label"]),

  mealServices: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    serviceDate: v.string(), // property-local YYYY-MM-DD
    mealType: vMealType, // one per property + date + mealType
    mealSlotId: v.id("mealSlots"),
    serviceTime: v.string(),
    endTime: v.optional(v.string()), // absent on services created before end times existed
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
    .index("by_resident_createdAt", ["residentId", "createdAt"])
    .index("by_resident_service", ["residentId", "mealServiceId", "createdAt"]),

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

  // A phone or browser that agreed to receive reminders (Web Push). One row
  // per device; removed when the push service says it's gone.
  pushSubscriptions: defineTable({
    organizationId: v.id("organizations"),
    propertyId: v.id("properties"),
    userId: v.id("users"),
    endpoint: v.string(), // unique
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_endpoint", ["endpoint"])
    .index("by_property", ["propertyId"])
    .index("by_user", ["userId"]),

  // Which reminder went out on which day, so each is sent only once.
  reminderRuns: defineTable({
    propertyId: v.id("properties"),
    date: v.string(), // property-local YYYY-MM-DD
    time: v.string(), // the reminder time "HH:mm"
    sentAt: v.number(),
    recipients: v.number(),
  }).index("by_property_date_time", ["propertyId", "date", "time"]),

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
    propertyId: v.optional(v.id("properties")), // absent for organisation-wide actions (staff, organisation name)
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
