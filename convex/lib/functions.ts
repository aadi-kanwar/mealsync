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
 *                          (an Admin is always allowed: Admins can do everything)
 *   residentQuery/Mutation - an approved, active resident of the property
 *
 * Internal wrappers (never callable from a browser; only from other backend
 * functions, scheduled jobs, or the owner via the Convex dashboard / CLI):
 *   internalQuery, internalMutation, internalAction
 *
 * All mutation wrappers also make `mealActivityLog` and `auditLogs`
 * append-only: patch / replace / delete on those tables throws.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { wrapDatabaseWriter } from "convex-helpers/server/rowLevelSecurity";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import {
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

/** The signed-in account, or null. Identity always comes from the session, never from arguments. */
export async function getViewer(ctx: ReadCtx): Promise<SignedInViewer | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const authUser = await ctx.db.get(userId);
  if (authUser === null) return null;
  return { userId, authUser };
}

export async function requireUser(ctx: ReadCtx): Promise<SignedInViewer> {
  const viewer = await getViewer(ctx);
  if (viewer === null) throw appError("NOT_SIGNED_IN");
  return viewer;
}

/** The single active property (V1 runs one PG). */
export async function getCurrentProperty(ctx: DbCtx): Promise<Doc<"properties">> {
  const properties = await ctx.db
    .query("properties")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .take(2);
  if (properties.length === 0) throw appError("NOT_SET_UP");
  if (properties.length > 1) {
    // V1 supports exactly one property. Fail loudly instead of guessing.
    throw new Error("More than one active property exists; V1 supports only one.");
  }
  return properties[0];
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

export type ProfiledViewer = SignedInViewer & {
  profile: Doc<"userProfiles">;
  property: Doc<"properties">;
};

export async function requireProfile(ctx: ReadCtx): Promise<ProfiledViewer> {
  const viewer = await requireUser(ctx);
  const profile = await getProfile(ctx, viewer.userId);
  if (profile === null) throw appError("PROFILE_REQUIRED");
  if (profile.status !== "active") throw appError("ACCOUNT_DISABLED");
  const property = await getCurrentProperty(ctx);
  return { ...viewer, profile, property };
}

/** Active staff roles the user holds at the property. */
export async function getStaffRoles(
  ctx: DbCtx,
  propertyId: Id<"properties">,
  userId: Id<"users">,
): Promise<StaffRole[]> {
  const rows = await ctx.db
    .query("staffRoles")
    .withIndex("by_property_user", (q) => q.eq("propertyId", propertyId).eq("userId", userId))
    .collect();
  return [...new Set(rows.filter((r) => r.status === "active").map((r) => r.role))];
}

export type StaffViewer = ProfiledViewer & { roles: StaffRole[] };

/**
 * Requires an active staff member holding one of `allowed`.
 * Admins always pass: per the role table, an Admin can do everything.
 */
export async function requireRole(
  ctx: ReadCtx,
  allowed: readonly StaffRole[],
): Promise<StaffViewer> {
  const viewer = await requireProfile(ctx);
  const roles = await getStaffRoles(ctx, viewer.property._id, viewer.userId);
  const permitted = roles.includes("admin") || roles.some((role) => allowed.includes(role));
  if (!permitted) throw appError("FORBIDDEN");
  return { ...viewer, roles };
}

export async function getResidentRecord(
  ctx: DbCtx,
  propertyId: Id<"properties">,
  userId: Id<"users">,
): Promise<Doc<"residents"> | null> {
  return await ctx.db
    .query("residents")
    .withIndex("by_property_user", (q) => q.eq("propertyId", propertyId).eq("userId", userId))
    .unique();
}

export type ResidentViewer = ProfiledViewer & { resident: Doc<"residents"> };

/** Requires an approved (active) resident. Pending, rejected and inactive residents are refused. */
export async function requireActiveResident(ctx: ReadCtx): Promise<ResidentViewer> {
  const viewer = await requireProfile(ctx);
  const resident = await getResidentRecord(ctx, viewer.property._id, viewer.userId);
  if (resident === null) throw appError("FORBIDDEN");
  if (resident.status !== "active") throw appError("RESIDENT_NOT_ACTIVE");
  return { ...viewer, resident };
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

export const staffQuery = customQuery(
  rawQuery,
  customCtx(async (ctx, extra: RolesArg) => ({
    staff: await requireRole(ctx, extra.roles),
  })),
);

export const staffMutation = customMutation(
  rawMutation,
  customCtx(async (ctx, extra: RolesArg) => ({
    staff: await requireRole(ctx, extra.roles),
    db: guardedDb(ctx),
  })),
);

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

// ---------------------------------------------------------------------------
// Internal wrappers (never callable from the browser).
// ---------------------------------------------------------------------------

export const internalQuery = rawInternalQuery;

export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(async (ctx) => ({ db: guardedDb(ctx) })),
);

export const internalAction = rawInternalAction;
