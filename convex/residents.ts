import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { staffMutation, staffQuery } from "./lib/functions";
import { isoDateSchema, roomNumberSchema } from "./lib/inputRules";

/** Loads a resident and confirms it belongs to the staff member's property. */
async function loadOwnResident(
  ctx: Pick<QueryCtx, "db">,
  propertyId: Id<"properties">,
  residentId: Id<"residents">,
): Promise<Doc<"residents">> {
  const resident = await ctx.db.get(residentId);
  if (resident === null || resident.propertyId !== propertyId) throw appError("NOT_FOUND");
  return resident;
}

/** New sign-ups waiting for approval. Admin/Warden only (includes phone numbers). */
export const listPending = staffQuery({
  roles: ["warden"],
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("residents")
      .withIndex("by_property_status", (q) =>
        q.eq("propertyId", ctx.staff.property._id).eq("status", "pending"),
      )
      .collect();
    const rows = await Promise.all(
      pending.map(async (resident) => {
        const profile = await ctx.db
          .query("userProfiles")
          .withIndex("by_authUserId", (q) => q.eq("authUserId", resident.userId))
          .unique();
        return {
          residentId: resident._id,
          displayName: resident.displayName,
          roomNumber: resident.roomNumber,
          phone: profile?.phone ?? null,
          signedUpAt: resident.createdAt,
        };
      }),
    );
    return rows.sort((a, b) => a.signedUpAt - b.signedUpAt);
  },
});

/** Number of sign-ups waiting. Any staff role (no personal details). */
export const pendingCount = staffQuery({
  roles: ["warden", "kitchen"],
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("residents")
      .withIndex("by_property_status", (q) =>
        q.eq("propertyId", ctx.staff.property._id).eq("status", "pending"),
      )
      .collect();
    return pending.length;
  },
});

export const approve = staffMutation({
  roles: ["warden"],
  args: { residentId: v.id("residents"), roomNumber: v.string(), validFrom: v.string() },
  handler: async (ctx, args) => {
    const room = roomNumberSchema.safeParse(args.roomNumber);
    if (!room.success) throw appError("INVALID_INPUT", room.error.issues[0]?.message);
    const date = isoDateSchema.safeParse(args.validFrom);
    if (!date.success) throw appError("INVALID_INPUT", date.error.issues[0]?.message);

    const { property, userId } = ctx.staff;
    const resident = await loadOwnResident(ctx, property._id, args.residentId);
    if (resident.status !== "pending") {
      throw appError("CONFLICT", "This sign-up has already been dealt with.");
    }
    const now = Date.now();
    await ctx.db.patch(resident._id, {
      status: "active",
      roomNumber: room.data,
      validFrom: date.data,
      approvedBy: userId,
      approvedAt: now,
    });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "resident.approved",
      entityType: "residents",
      entityId: resident._id,
      metadata: {
        roomNumberRequested: resident.roomNumber,
        roomNumberApproved: room.data,
        validFrom: date.data,
      },
    });
    return null;
  },
});

export const reject = staffMutation({
  roles: ["warden"],
  args: { residentId: v.id("residents") },
  handler: async (ctx, args) => {
    const { property, userId } = ctx.staff;
    const resident = await loadOwnResident(ctx, property._id, args.residentId);
    if (resident.status !== "pending") {
      throw appError("CONFLICT", "This sign-up has already been dealt with.");
    }
    await ctx.db.patch(resident._id, {
      status: "rejected",
      rejectedBy: userId,
      rejectedAt: Date.now(),
    });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "resident.rejected",
      entityType: "residents",
      entityId: resident._id,
    });
    return null;
  },
});
