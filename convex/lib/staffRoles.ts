import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { writeAudit } from "./audit";
import { appError } from "./errors";
import { getResidentRecord, getStaffRoles } from "./functions";
import type { StaffRole } from "./validators";

/**
 * Grants a staff role. Shared by the Admin screen and the one-time
 * first-Admin setup step. Callers must have checked permissions already.
 */
export async function grantStaffRole(
  ctx: Pick<MutationCtx, "db">,
  args: {
    property: Doc<"properties">;
    targetUserId: Id<"users">;
    role: StaffRole;
    grantedBy: Id<"users"> | undefined;
    auditAction: "staff.role_granted" | "setup.first_admin_created";
  },
): Promise<Id<"staffRoles">> {
  const { property, targetUserId, role, grantedBy } = args;
  const existing = await getStaffRoles(ctx, property._id, targetUserId);
  if (existing.includes(role)) throw appError("CONFLICT", "This person already has that role.");

  const staffRoleId = await ctx.db.insert("staffRoles", {
    organizationId: property.organizationId,
    propertyId: property._id,
    userId: targetUserId,
    role,
    status: "active",
    grantedBy,
    grantedAt: Date.now(),
  });
  await writeAudit(ctx, {
    property,
    actorUserId: grantedBy,
    action: args.auditAction,
    entityType: "staffRoles",
    entityId: staffRoleId,
    metadata: { role, targetUserId },
  });

  // A staff member's own un-approved resident sign-up would otherwise sit in
  // the "New sign-ups" list. Close it (approved residents are left alone:
  // a resident may also work in the kitchen).
  const resident = await getResidentRecord(ctx, property._id, targetUserId);
  if (resident !== null && resident.status === "pending") {
    await ctx.db.patch(resident._id, { status: "inactive" });
    await writeAudit(ctx, {
      property,
      actorUserId: grantedBy,
      action: "resident.withdrawn_for_staff",
      entityType: "residents",
      entityId: resident._id,
      metadata: { role },
    });
  }
  return staffRoleId;
}
