import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  getProfile,
  getStaffRoles,
  internalMutation,
  internalQuery,
  staffAction,
  staffMutation,
  staffQuery,
} from "./lib/functions";
import { isoDateSchema, roomNumberSchema } from "./lib/inputRules";
import { addDays, localDateString } from "./lib/time";

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

/** Number of sign-ups waiting. Admin/Warden. */
export const pendingCount = staffQuery({
  roles: ["warden"],
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

/**
 * Current residents (approved) and those who have moved out, with what the
 * Warden needs to manage them. Admin/Warden only (includes phone numbers).
 */
export const list = staffQuery({
  roles: ["warden"],
  args: {},
  handler: async (ctx) => {
    const propertyId = ctx.staff.property._id;
    const byStatus = (status: "active" | "inactive") =>
      ctx.db
        .query("residents")
        .withIndex("by_property_status", (q) => q.eq("propertyId", propertyId).eq("status", status))
        .collect();
    const residents = [...(await byStatus("active")), ...(await byStatus("inactive"))];
    const rows = await Promise.all(
      residents.map(async (resident) => {
        const profile = await getProfile(ctx, resident.userId);
        const isStaff = (await getStaffRoles(ctx, propertyId, resident.userId)).length > 0;
        return {
          residentId: resident._id,
          displayName: resident.displayName,
          roomNumber: resident.roomNumber,
          phone: profile?.phone ?? null,
          status: resident.status as "active" | "inactive",
          validFrom: resident.validFrom ?? null,
          validUntil: resident.validUntil ?? null,
          mustChangePassword: profile?.mustChangePassword === true,
          // Staff accounts can't be reset from here (a Warden could take over an Admin's account).
          canResetPassword: resident.status === "active" && !isStaff && profile !== null,
        };
      }),
    );
    return rows.sort((a, b) =>
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }) ||
      a.displayName.localeCompare(b.displayName),
    );
  },
});

/**
 * Records that a resident is leaving: `lastDay` is the last day they are
 * counted for meals. Their history is kept. After that day the nightly job
 * closes their account for meals (see endStays).
 */
export const moveOut = staffMutation({
  roles: ["warden"],
  args: { residentId: v.id("residents"), lastDay: v.string() },
  handler: async (ctx, args) => {
    const date = isoDateSchema.safeParse(args.lastDay);
    if (!date.success) throw appError("INVALID_INPUT", date.error.issues[0]?.message);
    const { property, userId } = ctx.staff;
    const resident = await loadOwnResident(ctx, property._id, args.residentId);
    if (resident.status !== "active") throw appError("CONFLICT", "This person isn't a current resident.");
    const today = localDateString(Date.now(), property.timezone);
    if (date.data < addDays(today, -1)) {
      throw appError("INVALID_INPUT", "The last day can be yesterday at the earliest, so past counts stay as they were.");
    }
    if (resident.validFrom !== undefined && date.data < resident.validFrom) {
      throw appError("INVALID_INPUT", "The last day can't be before the day they started.");
    }
    await ctx.db.patch(resident._id, { validUntil: date.data });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "resident.moved_out",
      entityType: "residents",
      entityId: resident._id,
      metadata: { lastDay: date.data, previousLastDay: resident.validUntil ?? null },
    });
    return null;
  },
});

/** Undoes a move-out that was entered by mistake (only while the resident is still current). */
export const cancelMoveOut = staffMutation({
  roles: ["warden"],
  args: { residentId: v.id("residents") },
  handler: async (ctx, args) => {
    const { property, userId } = ctx.staff;
    const resident = await loadOwnResident(ctx, property._id, args.residentId);
    if (resident.status !== "active" || resident.validUntil === undefined) {
      throw appError("CONFLICT", "There's no move-out to undo.");
    }
    await ctx.db.patch(resident._id, { validUntil: undefined });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "resident.move_out_cancelled",
      entityType: "residents",
      entityId: resident._id,
      metadata: { cancelledLastDay: resident.validUntil },
    });
    return null;
  },
});

/**
 * Daily scheduled job (see crons.ts): residents whose last day has passed
 * become "moved out". They can still sign in and see that their stay ended.
 */
export const endStays = internalMutation({
  args: {},
  handler: async (ctx) => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .first();
    if (property === null) return 0;
    const today = localDateString(Date.now(), property.timezone);
    const active = await ctx.db
      .query("residents")
      .withIndex("by_property_status", (q) => q.eq("propertyId", property._id).eq("status", "active"))
      .collect();
    let ended = 0;
    for (const resident of active) {
      if (resident.validUntil === undefined || resident.validUntil >= today) continue;
      await ctx.db.patch(resident._id, { status: "inactive" });
      await writeAudit(ctx, {
        property,
        actorUserId: undefined,
        action: "resident.stay_ended",
        entityType: "residents",
        entityId: resident._id,
        metadata: { lastDay: resident.validUntil },
      });
      ended += 1;
    }
    return ended;
  },
});

// Letters and digits that are hard to confuse when read out (no 0/o, 1/l/i).
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** e.g. "kq7m-p3rx": 8 random characters, easy to read out loud. */
function temporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/**
 * Gives a resident who forgot their password a temporary one, shown once to
 * the staff member to read out. The resident's devices are signed out and
 * they must choose a new password when they next sign in. The password is
 * never stored in plain text or written to any log.
 */
export const resetPassword = staffAction({
  roles: ["warden"],
  args: { residentId: v.id("residents") },
  handler: async (ctx, args): Promise<{ temporaryPassword: string }> => {
    const target = await ctx.runQuery(internal.residents.resetTarget, {
      propertyId: ctx.staff.propertyId,
      residentId: args.residentId,
    });
    const password = temporaryPassword();
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: target.phone, secret: password },
    });
    await invalidateSessions(ctx, { userId: target.userId });
    await ctx.runMutation(internal.residents.recordPasswordReset, {
      residentId: args.residentId,
      actorUserId: ctx.staff.userId,
    });
    return { temporaryPassword: password };
  },
});

/** Checks the reset is allowed and finds the login to change. */
export const resetTarget = internalQuery({
  args: { propertyId: v.id("properties"), residentId: v.id("residents") },
  returns: v.object({ userId: v.id("users"), phone: v.string() }),
  handler: async (ctx, args) => {
    const resident = await loadOwnResident(ctx, args.propertyId, args.residentId);
    if (resident.status !== "active") {
      throw appError("CONFLICT", "Only current residents' passwords can be reset here.");
    }
    if ((await getStaffRoles(ctx, args.propertyId, resident.userId)).length > 0) {
      throw appError("FORBIDDEN", "Staff passwords can't be reset from here.");
    }
    const user = await ctx.db.get(resident.userId);
    if (!user?.phone) throw appError("NOT_FOUND");
    return { userId: resident.userId, phone: user.phone };
  },
});

export const recordPasswordReset = internalMutation({
  args: { residentId: v.id("residents"), actorUserId: v.id("users") },
  handler: async (ctx, args) => {
    const resident = (await ctx.db.get(args.residentId))!;
    const profile = await getProfile(ctx, resident.userId);
    if (profile !== null) await ctx.db.patch(profile._id, { mustChangePassword: true });
    const property = (await ctx.db.get(resident.propertyId))!;
    await writeAudit(ctx, {
      property,
      actorUserId: args.actorUserId,
      action: "resident.password_reset",
      entityType: "residents",
      entityId: resident._id,
    });
    return null;
  },
});
