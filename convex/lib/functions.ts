/**
 * The ONLY place in the backend allowed to use Convex's raw `query`,
 * `mutation`, `internalQuery`, `internalMutation` and `internalAction`
 * builders. Every other file must build its functions from the wrappers
 * exported here, so no function can skip the permission checks.
 * (Enforced by ESLint and by convex/tests/enforcement.test.ts.)
 *
 * Wrappers that browsers can call:
 *   viewerQuery          - signed in or not; ctx.viewer is null when signed out
 *   signedInQuery/Mutation  - any signed-in account (even without a profile)
 *   staffQuery/Mutation  - an active staff member with one of `roles`
 *                          (an Admin is always allowed: Admins can do everything).
 *                          Takes an optional `propertyId` argument: the property
 *                          the screen is showing. ctx.staff.properties is every
 *                          property the caller may see; ctx.staff.property is the
 *                          chosen one (or their only one), else null = "all".
 *   residentQuery/Mutation - an approved, active resident (ctx.resident.property
 *                          is the property they live in)
 *   signedInAction, staffAction - the same checks for actions (needed for
 *                          password changes), done by an internal query
 *                          before the action's own code runs
 *
 * Internal wrappers (never callable from a browser; only from other backend
 * functions, scheduled jobs, or the owner via the Convex dashboard / CLI):
 *   internalQuery, internalMutation, internalAction
 *
 * All mutation wrappers also make `mealActivityLog` and `auditLogs`
 * append-only: patch / replace / delete on those tables throws.
 */
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { wrapDatabaseWriter } from "convex-helpers/server/rowLevelSecurity";
import { v } from "convex/values";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import {
  action as rawAction,
  internalAction as rawInternalAction,
  internalMutation as rawInternalMutation,
  internalQuery as rawInternalQuery,
  mutation as rawMutation,
  query as rawQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { appError } from "./errors";
import type { StaffRole } from "./validators";

type ReadCtx = Pick<QueryCtx, "db" | "auth">;
type DbCtx = Pick<QueryCtx, "db">;

// ---------------------------------------------------------------------------
// Shared permission helpers. Wrappers call these; handlers may call them too.
// ---------------------------------------------------------------------------

export type SignedInViewer = {
  userId: Id<"users">;
  authUser: Doc<"users">;
};

/**
 * The signed-in account, or null. Identity always comes from the session,
 * never from arguments. The session must still exist: when a password is
 * reset or changed, other sessions are deleted, and a login token issued
 * before that stops working at once rather than when it expires.
 */
export async function getViewer(ctx: ReadCtx): Promise<SignedInViewer | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId === null || (await ctx.db.get(sessionId)) === null) return null;
  const authUser = await ctx.db.get(userId);
  if (authUser === null) return null;
  return { userId, authUser };
}

export async function requireUser(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await getViewer(ctx);
  if (viewer === null) throw appError("NOT_SIGNED_IN");
  return viewer;
}

export async function getProfile(
  ctx: DbCtx,
  userId: Id<"users">,
): Promise<Doc<"userProfiles"> | null> {
  return await ctx.db
    .query("userProfiles")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", userId))
    .unique();
}

export type ProfiledViewer = SignedInViewer & { profile: Doc<"userProfiles"> };

export async function requireProfile(ctx: ReadCtx): Promise<ProfiledViewer> {
  const viewer = await requireUser(ctx);
  const profile = await getProfile(ctx, viewer.userId);
  if (profile === null) throw appError("PROFILE_REQUIRED");
  if (profile.status !== "active") throw appError("ACCOUNT_DISABLED");
  return { ...viewer, profile };
}

const byName = (a: Doc<"properties">, b: Doc<"properties">) => a.name.localeCompare(b.name);

/** Active properties of an organisation, by name. */
export async function organizationProperties(
  ctx: DbCtx,
  organizationId: Id<"organizations">,
): Promise<Doc<"properties">[]> {
  const rows = await ctx.db
    .query("properties")
    .withIndex("by_org_status", (q) => q.eq("organizationId", organizationId).eq("status", "active"))
    .collect();
  return rows.sort(byName);
}

/**
 * What a staff member can see. A person is staff of at most one
 * organisation. An Admin sees every property of it; a Warden only the
 * properties they're assigned to.
 */
export type StaffAccess = {
  organization: Doc<"organizations">;
  roles: StaffRole[];
  isAdmin: boolean;
  properties: Doc<"properties">[];
};

export async function getStaffAccess(ctx: DbCtx, userId: Id<"users">): Promise<StaffAccess | null> {
  const rows = await ctx.db
    .query("staffRoles")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
    .collect();
  if (rows.length === 0) return null;
  const organization = await ctx.db.get(rows[0].organizationId);
  if (organization === null || organization.status !== "active") return null;
  const mine = rows.filter((r) => r.organizationId === organization._id);
  const isAdmin = mine.some((r) => r.role === "admin");
  const all = await organizationProperties(ctx, organization._id);
  // Admin rows are organisation-wide (older ones may still carry a propertyId; it's ignored).
  const assigned = new Set(mine.filter((r) => r.role === "warden").map((r) => r.propertyId));
  return {
    organization,
    roles: [...new Set(mine.map((r) => r.role))],
    isAdmin,
    properties: isAdmin ? all : all.filter((p) => assigned.has(p._id)),
  };
}

/** Active staff roles the user holds for one property (an Admin's apply to every property of their organisation). */
export async function getStaffRoles(
  ctx: DbCtx,
  propertyId: Id<"properties">,
  userId: Id<"users">,
): Promise<StaffRole[]> {
  const access = await getStaffAccess(ctx, userId);
  if (access === null || !access.properties.some((p) => p._id === propertyId)) return [];
  return access.roles;
}

export type StaffViewer = ProfiledViewer &
  StaffAccess & {
    /** The property chosen on screen, or the staff member's only property; null means all of `properties`. */
    property: Doc<"properties"> | null;
  };

/**
 * Requires an active staff member holding one of `allowed`.
 * Admins always pass: per the role table, an Admin can do everything.
 * `propertyId`, when given, must be one of the caller's properties.
 */
export async function requireRole(
  ctx: ReadCtx,
  allowed: readonly StaffRole[],
  propertyId?: Id<"properties">,
): Promise<StaffViewer> {
  const viewer = await requireProfile(ctx);
  const access = await getStaffAccess(ctx, viewer.userId);
  if (access === null) throw appError("FORBIDDEN");
  const permitted = access.isAdmin || access.roles.some((role) => allowed.includes(role));
  if (!permitted) throw appError("FORBIDDEN");
  let property: Doc<"properties"> | null = null;
  if (propertyId !== undefined) {
    property = access.properties.find((p) => p._id === propertyId) ?? null;
    if (property === null) throw appError("FORBIDDEN");
  } else if (access.properties.length === 1) {
    property = access.properties[0];
  }
  return { ...viewer, ...access, property };
}

/** The one property a screen is about. Throws when "all properties" is selected. */
export function oneProperty(staff: Pick<StaffViewer, "property">): Doc<"properties"> {
  if (staff.property === null) throw appError("CHOOSE_PROPERTY");
  return staff.property;
}

/** The properties a screen covers: the chosen one, or all the caller's. */
export function inScope(staff: Pick<StaffViewer, "property" | "properties">): Doc<"properties">[] {
  if (staff.property) return [staff.property];
  if (staff.properties.length === 0) throw appError("FORBIDDEN", "You aren't assigned to any property yet.");
  return staff.properties;
}

/** Loads a resident the staff member may manage (one of their properties), else NOT_FOUND. */
export async function loadManagedResident(
  ctx: DbCtx,
  staff: Pick<StaffViewer, "properties">,
  residentId: Id<"residents">,
): Promise<{ resident: Doc<"residents">; property: Doc<"properties"> }> {
  const resident = await ctx.db.get(residentId);
  const property = resident && staff.properties.find((p) => p._id === resident.propertyId);
  if (!resident || !property) throw appError("NOT_FOUND");
  return { resident, property };
}

const RESIDENT_ORDER = { active: 0, pending: 1, inactive: 2, rejected: 3 } as const;

/**
 * The person's resident record: the current one if any, else the latest
 * sign-up. (One per sign-up; a person lives in one property at a time.)
 */
export async function getResidentRecord(ctx: DbCtx, userId: Id<"users">): Promise<Doc<"residents"> | null> {
  const rows = await ctx.db
    .query("residents")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  rows.sort((a, b) => RESIDENT_ORDER[a.status] - RESIDENT_ORDER[b.status] || b.createdAt - a.createdAt);
  return rows[0] ?? null;
}

export type ResidentViewer = ProfiledViewer & { resident: Doc<"residents">; property: Doc<"properties"> };

/** Requires an approved (active) resident. Pending, rejected and inactive residents are refused. */
export async function requireActiveResident(ctx: ReadCtx): Promise<ResidentViewer> {
  const viewer = await requireProfile(ctx);
  const resident = await getResidentRecord(ctx, viewer.userId);
  if (resident === null) throw appError("FORBIDDEN");
  if (resident.status !== "active") throw appError("RESIDENT_NOT_ACTIVE");
  const property = await ctx.db.get(resident.propertyId);
  if (property === null || property.status !== "active") throw appError("RESIDENT_NOT_ACTIVE");
  return { ...viewer, resident, property };
}

// ---------------------------------------------------------------------------
// Append-only tables.
// ---------------------------------------------------------------------------

const appendOnlyRules = {
  mealActivityLog: { modify: async () => false },
  auditLogs: { modify: async () => false },
};

/** Exported for tests; every mutation wrapper below uses it. */
export function guardedDb(ctx: MutationCtx): MutationCtx["db"] {
  return wrapDatabaseWriter<MutationCtx, DataModel>(ctx, ctx.db, appendOnlyRules);
}

// ---------------------------------------------------------------------------
// Public wrappers (callable from the browser).
// ---------------------------------------------------------------------------

export const viewerQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ viewer: await getViewer(ctx) })),
);

export const signedInQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ viewer: await requireUser(ctx) })),
);

export const signedInMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({ viewer: await requireUser(ctx), db: guardedDb(ctx) })),
);

type RolesArg = { roles: readonly StaffRole[] };

/** Every staff function takes this argument: the property the screen shows (omit for all / the only one). */
const propertyArg = { propertyId: v.optional(v.id("properties")) };

export const staffQuery = customQuery(rawQuery, {
  args: propertyArg,
  input: async (ctx, args, extra: RolesArg) => ({
    ctx: { staff: await requireRole(ctx, extra.roles, args.propertyId) },
    args: {},
  }),
});

export const staffMutation = customMutation(rawMutation, {
  args: propertyArg,
  input: async (ctx, args, extra: RolesArg) => ({
    ctx: { staff: await requireRole(ctx, extra.roles, args.propertyId), db: guardedDb(ctx) },
    args: {},
  }),
});

export const residentQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ resident: await requireActiveResident(ctx) })),
);

export const residentMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({
    resident: await requireActiveResident(ctx),
    db: guardedDb(ctx),
  })),
);

// Actions have no database access, so they check the caller through these
// internal queries (convex/access.ts), which run the same helpers as above.
// Referenced by name to avoid a circular import of the generated API.

export type ActionViewer = { userId: Id<"users">; phone: string; mustChangePassword: boolean };
export type ActionStaff = {
  userId: Id<"users">;
  /** Every property the caller may see. */
  propertyIds: Id<"properties">[];
  displayName: string;
  roles: StaffRole[];
};

const viewerForAction = makeFunctionReference<"query", Record<string, never>, ActionViewer>(
  "access:viewerForAction",
);
const staffForAction = makeFunctionReference<"query", { roles: StaffRole[] }, ActionStaff>(
  "access:staffForAction",
);

export const signedInAction = customAction(
  rawAction,
  customCtx(async (ctx) => ({ viewer: await ctx.runQuery(viewerForAction, {}) })),
);

export const staffAction = customAction(
  rawAction,
  customCtx(async (ctx, extra: RolesArg) => ({
    staff: await ctx.runQuery(staffForAction, { roles: [...extra.roles] }),
  })),
);

// ---------------------------------------------------------------------------
// Internal wrappers (never callable from the browser).
// ---------------------------------------------------------------------------

export const internalQuery = rawInternalQuery;

export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(async (ctx) => ({ db: guardedDb(ctx) })),
);

export const internalAction = rawInternalAction;
