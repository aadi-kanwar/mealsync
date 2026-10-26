import { getAuthSessionId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { PHONE_PASSWORD_PROVIDER } from "./auth";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import {
  getCurrentProperty,
  getProfile,
  getResidentRecord,
  getStaffRoles,
  internalMutation,
  signedInAction,
  signedInMutation,
  viewerQuery,
} from "./lib/functions";
import { passwordProblem, profileSchema } from "./lib/inputRules";

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
      profile: profile && {
        displayName: profile.displayName,
        status: profile.status,
        mustChangePassword: profile.mustChangePassword === true,
      },
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
 * Saves name and room and creates a *pending* resident record. The phone
 * number always comes from the login, never from the browser.
 */
async function createProfile(
  ctx: Pick<MutationCtx, "db">,
  args: { userId: Id<"users">; phone: string | undefined; displayName: string; roomNumber: string },
): Promise<void> {
  const parsed = profileSchema.safeParse(args);
  if (!parsed.success) throw appError("INVALID_INPUT", parsed.error.issues[0]?.message);
  const { displayName, roomNumber } = parsed.data;
  const { userId, phone } = args;

  if ((await getProfile(ctx, userId)) !== null) throw appError("PROFILE_EXISTS");
  if (!phone) throw appError("INVALID_INPUT", "Your account has no phone number.");
  const samePhone = await ctx.db
    .query("userProfiles")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
  if (samePhone !== null) throw appError("CONFLICT");

  const property = await getCurrentProperty(ctx);
  const now = Date.now();
  await ctx.db.insert("userProfiles", { authUserId: userId, displayName, phone, status: "active", createdAt: now });
  if ((await getResidentRecord(ctx, property._id, userId)) !== null) throw appError("CONFLICT");
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
}

/** Called by the login provider right after a new account is created (name and room come from the sign-up form). */
export const createProfileAtSignUp = internalMutation({
  args: { userId: v.id("users"), displayName: v.string(), roomNumber: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    await createProfile(ctx, { ...args, phone: user?.phone });
    return null;
  },
});

/**
 * Fallback for accounts created without a name and room (older accounts, or
 * if saving them at sign-up failed): ask once, then never again.
 */
export const completeProfile = signedInMutation({
  args: { displayName: v.string(), roomNumber: v.string() },
  handler: async (ctx, args) => {
    const { userId, authUser } = ctx.viewer;
    await createProfile(ctx, { userId, phone: authUser.phone, ...args });
    return null;
  },
});

/**
 * Sets a new password. Needs the current one, except right after staff
 * reset it (then the temporary password was just used to sign in). Signs
 * out the person's other devices.
 */
export const changePassword = signedInAction({
  args: { currentPassword: v.optional(v.string()), newPassword: v.string() },
  handler: async (ctx, args) => {
    const { userId, phone, mustChangePassword } = ctx.viewer;
    if (!phone) throw appError("INVALID_INPUT", "Your account has no phone number.");
    if (!mustChangePassword) {
      try {
        await retrieveAccount(ctx, {
          provider: PHONE_PASSWORD_PROVIDER,
          account: { id: phone, secret: args.currentPassword ?? "" },
        });
      } catch {
        throw appError("INVALID_INPUT", "Your current password isn't right.");
      }
    }
    const problem = passwordProblem(args.newPassword, phone);
    if (problem !== null) throw appError("WEAK_PASSWORD", problem);
    if (args.newPassword === args.currentPassword) {
      throw appError("WEAK_PASSWORD", "Choose a password different from the current one.");
    }
    await modifyAccountCredentials(ctx, {
      provider: PHONE_PASSWORD_PROVIDER,
      account: { id: phone, secret: args.newPassword },
    });
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, { userId, except: sessionId ? [sessionId] : [] });
    await ctx.runMutation(internal.users.recordPasswordChanged, { userId });
    return null;
  },
});

export const recordPasswordChanged = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx, args.userId);
    if (profile?.mustChangePassword) await ctx.db.patch(profile._id, { mustChangePassword: false });
    const property = await getCurrentProperty(ctx);
    await writeAudit(ctx, {
      property,
      actorUserId: args.userId,
      action: "user.password_changed",
      entityType: "users",
      entityId: args.userId,
    });
    return null;
  },
});
