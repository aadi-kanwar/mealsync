import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type AuditAction =
  | "property.created"
  | "resident.signed_up"
  | "resident.approved"
  | "resident.rejected"
  | "resident.withdrawn_for_staff"
  | "staff.role_granted"
  | "staff.role_revoked"
  | "setup.first_admin_created"
  | "dev.seeded"
  | "resident.moved_out"
  | "resident.move_out_cancelled"
  | "resident.stay_ended"
  | "resident.password_reset"
  | "user.password_changed"
  | "menu.updated"
  | "menu.rotation_set"
  | "settings.updated"
  | "settings.meal_times_updated"
  | "settings.reminders_updated"
  | "report.exported"
  | "resident.details_updated"
  | "organization.created"
  | "organization.renamed"
  | "staff.properties_updated";

/**
 * Appends one audit entry. Callers must never put passwords, tokens or
 * other secrets in `metadata`.
 */
export async function writeAudit(
  ctx: Pick<MutationCtx, "db">,
  entry: {
    /** The property it's about, or `{ organizationId }` for organisation-wide actions. */
    property: Pick<Doc<"properties">, "_id" | "organizationId"> | { _id?: undefined; organizationId: Id<"organizations"> };
    actorUserId: Id<"users"> | undefined;
    action: AuditAction;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.db.insert("auditLogs", {
    organizationId: entry.property.organizationId,
    propertyId: entry.property._id,
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    createdAt: Date.now(),
  });
}
