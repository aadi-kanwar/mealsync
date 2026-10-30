import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { writeAudit } from "./audit";
import { appError } from "./errors";
import { getResidentRecord, organizationProperties } from "./functions";
import type { StaffRole } from "./validators";

type Db = Pick<MutationCtx, "db">;

async function activeRows(ctx: Db, userId: Id<"users">) {
  return await ctx.db
    .query("staffRoles")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
    .collect();
}

/** The organisation's properties among `propertyIds`; refuses unknown ones and an empty list. */
async function checkProperties(ctx: Db, organizationId: Id<"organizations">, propertyIds: readonly Id<"properties">[]) {
  const ids = [...new Set(propertyIds)];
  if (ids.length === 0) throw appError("INVALID_INPUT", "Choose at least one property.");
  const own = new Set((await organizationProperties(ctx, organizationId)).map((p) => p._id));
  if (ids.some((id) => !own.has(id))) throw appError("NOT_FOUND", "That property wasn't found.");
  return ids;
}

/**
 * Grants a staff role in an organisation. Admins cover every property;
 * Wardens cover `propertyIds`. A person can be staff of one organisation
 * only. Shared by the Staff screen, organisation sign-up and the one-time
 * first-Admin setup step. Callers must have checked permissions already.
 */
export async function grantStaffRole(
  ctx: Db,
  args: {
    organizationId: Id<"organizations">;
    targetUserId: Id<"users">;
    role: StaffRole;
    propertyIds?: readonly Id<"properties">[];
    grantedBy: Id<"users"> | undefined;
    auditAction: "staff.role_granted" | "setup.first_admin_created" | "organization.created";
  },
): Promise<void> {
  const { organizationId, targetUserId, role, grantedBy } = args;
  const existing = await activeRows(ctx, targetUserId);
  if (existing.some((r) => r.organizationId !== organizationId)) {
    throw appError("CONFLICT", "This person is already staff of another organisation.");
  }
  const now = Date.now();
  if (role === "admin") {
    if (existing.some((r) => r.role === "admin")) throw appError("CONFLICT", "This person is already an Admin.");
    await ctx.db.insert("staffRoles", { organizationId, userId: targetUserId, role, status: "active", grantedBy, grantedAt: now });
    // Admins see every property; separate Warden assignments would only confuse.
    for (const row of existing.filter((r) => r.role === "warden")) {
      await ctx.db.patch(row._id, { status: "inactive", revokedBy: grantedBy, revokedAt: now });
    }
  } else {
    if (existing.some((r) => r.role === "admin")) throw appError("CONFLICT", "This person is already an Admin.");
    if (existing.some((r) => r.role === "warden")) {
      throw appError("CONFLICT", "This person is already a Warden. Change their properties instead.");
    }
    for (const propertyId of await checkProperties(ctx, organizationId, args.propertyIds ?? [])) {
      await ctx.db.insert("staffRoles", {
        organizationId,
        propertyId,
        userId: targetUserId,
        role,
        status: "active",
        grantedBy,
        grantedAt: now,
      });
    }
  }
  await writeAudit(ctx, {
    property: { organizationId },
    actorUserId: grantedBy,
    action: args.auditAction,
    entityType: "users",
    entityId: targetUserId,
    metadata: { role, propertyIds: args.propertyIds ?? null },
  });

  // A staff member's own un-approved resident sign-up would otherwise sit in
  // the "New sign-ups" list. Close it (approved residents are left alone:
  // a resident may also be a Warden).
  const resident = await getResidentRecord(ctx, targetUserId);
  if (resident !== null && resident.status === "pending" && resident.organizationId === organizationId) {
    await ctx.db.patch(resident._id, { status: "inactive" });
    await writeAudit(ctx, {
      property: { _id: resident.propertyId, organizationId },
      actorUserId: grantedBy,
      action: "resident.withdrawn_for_staff",
      entityType: "residents",
      entityId: resident._id,
      metadata: { role },
    });
  }
}

/** Changes which properties a Warden looks after. */
export async function setWardenProperties(
  ctx: Db,
  args: {
    organizationId: Id<"organizations">;
    targetUserId: Id<"users">;
    propertyIds: readonly Id<"properties">[];
    actorUserId: Id<"users">;
  },
): Promise<void> {
  const wanted = new Set(await checkProperties(ctx, args.organizationId, args.propertyIds));
  const rows = (await activeRows(ctx, args.targetUserId)).filter(
    (r) => r.organizationId === args.organizationId && r.role === "warden",
  );
  if (rows.length === 0) throw appError("NOT_FOUND", "This person isn't a Warden.");
  const now = Date.now();
  const before = rows.map((r) => r.propertyId);
  for (const row of rows) {
    if (row.propertyId === undefined || !wanted.has(row.propertyId)) {
      await ctx.db.patch(row._id, { status: "inactive", revokedBy: args.actorUserId, revokedAt: now });
    }
  }
  for (const propertyId of wanted) {
    if (rows.some((r) => r.propertyId === propertyId)) continue;
    await ctx.db.insert("staffRoles", {
      organizationId: args.organizationId,
      propertyId,
      userId: args.targetUserId,
      role: "warden",
      status: "active",
      grantedBy: args.actorUserId,
      grantedAt: now,
    });
  }
  await writeAudit(ctx, {
    property: { organizationId: args.organizationId },
    actorUserId: args.actorUserId,
    action: "staff.properties_updated",
    entityType: "users",
    entityId: args.targetUserId,
    metadata: { before, after: [...wanted] },
  });
}
