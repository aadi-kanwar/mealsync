import { v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  getCurrentProperty,
  getProfile,
  getResidentRecord,
  getStaffRoles,
  signedInMutation,
  viewerQuery,
} from "./lib/functions";
import { profileSchema } from "./lib/inputRules";

/**
 * Everything the app needs to decide which screen to show the signed-in
 * person. Returns null when signed out. Only ever describes the caller.
 */
export const me = viewerQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.viewer === null) return null;
    const { userId, authUser } = ctx.viewer;
    const profile = await getProfile(ctx, userId);
    const property = await ctx.db
      .query("properties")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .first();
    const roles = property ? await getStaffRoles(ctx, property._id, userId) : [];
    const resident = property ? await getResidentRecord(ctx, property._id, userId) : null;
    return {
      phone: authUser.phone ?? null,
      profile: profile && { displayName: profile.displayName, status: profile.status },
      property: property && { name: property.name, timezone: property.timezone },
      staffRoles: roles,
      resident: resident && {
        status: resident.status,
        roomNumber: resident.roomNumber,
        validFrom: resident.validFrom ?? null,
        validUntil: resident.validUntil ?? null,
      },
    };
  },
});

/**
 * First sign-in only: save name and room, and create a *pending* resident
 * record. The phone number comes from the login, never from the browser.
 */
export const completeProfile = signedInMutation({
  args: { displayName: v.string(), roomNumber: v.string() },
  handler: async (ctx, args) => {
    const parsed = profileSchema.safeParse(args);
    if (!parsed.success) {
      throw appError("INVALID_INPUT", parsed.error.issues[0]?.message);
    }
    const { displayName, roomNumber } = parsed.data;
    const { userId, authUser } = ctx.viewer;

    if ((await getProfile(ctx, userId)) !== null) throw appError("PROFILE_EXISTS");
    const phone = authUser.phone;
    if (!phone) throw appError("INVALID_INPUT", "Your account has no phone number.");
    const samePhone = await ctx.db
      .query("userProfiles")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (samePhone !== null) throw appError("CONFLICT");

    const property = await getCurrentProperty(ctx);
    const now = Date.now();
    await ctx.db.insert("userProfiles", {
      authUserId: userId,
      displayName,
      phone,
      status: "active",
      createdAt: now,
    });
    if ((await getResidentRecord(ctx, property._id, userId)) !== null) {
      throw appError("CONFLICT");
    }
    const residentId = await ctx.db.insert("residents", {
      organizationId: property.organizationId,
      propertyId: property._id,
      userId,
      displayName,
      roomNumber,
      status: "pending",
      createdAt: now,
    });
    await writeAudit(ctx, {
      property,
      actorUserId: userId,
      action: "resident.signed_up",
      entityType: "residents",
      entityId: residentId,
      metadata: { roomNumber },
    });
    return null;
  },
});
