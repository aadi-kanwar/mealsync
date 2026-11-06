import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { getProfile, internalMutation, viewerQuery } from "./lib/functions";
import { SSO_SESSION_MS, SSO_USED_TICKET_RETENTION_MS } from "./lib/ssoTicket";

/**
 * Admin Hub single sign-on: what happens once a ticket's signature has been
 * checked (see convex/lib/ssoTicket.ts and the `hub-sso` provider in
 * convex/auth.ts).
 *
 * The master admin gets the Admin role in the organisation, keeping anything
 * they already had (a Warden keeps their properties, a resident stays a
 * resident). No other account, role or record is changed.
 */
export const acceptTicket = internalMutation({
  args: { jti: v.string(), hubAdminId: v.string(), phone: v.string(), name: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), sessionId: v.id("authSessions") })),
  handler: async (ctx, { jti, hubAdminId, phone, name }) => {
    const now = Date.now();

    // 1. One use per ticket. Recorded first, so even a refused ticket is spent.
    const used = await ctx.db
      .query("ssoUsedTickets")
      .withIndex("by_jti", (q) => q.eq("jti", jti))
      .first();
    if (used !== null) return null;
    await ctx.db.insert("ssoUsedTickets", { jti, usedAt: now });

    // 2. The organisation: Dine runs a single one.
    const organization = await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("asc")
      .first();
    if (organization === null) return null;

    // 3. The account with this phone number, or a new one.
    let userId: Id<"users">;
    let accountCreated = false;
    const profileByPhone = await ctx.db
      .query("userProfiles")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (profileByPhone !== null) {
      // A switched-off account stays switched off.
      if (profileByPhone.status !== "active") return null;
      userId = profileByPhone.authUserId;
    } else {
      const existingUser = await ctx.db
        .query("users")
        .withIndex("phone", (q) => q.eq("phone", phone))
        .first();
      if (existingUser !== null) {
        userId = existingUser._id;
      } else {
        userId = await ctx.db.insert("users", { phone, name });
        accountCreated = true;
      }
      if ((await getProfile(ctx, userId)) === null) {
        await ctx.db.insert("userProfiles", {
          authUserId: userId,
          displayName: name,
          phone,
          status: "active",
          createdAt: now,
        });
      }
    }
    const user = await ctx.db.get(userId);
    if (user === null) return null;

    // 4. The Admin role, added only if missing. Existing roles are kept as they are.
    const roles = await ctx.db
      .query("staffRoles")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .collect();
    // A person can be staff of one organisation only; never move someone.
    if (roles.some((r) => r.organizationId !== organization._id)) return null;
    let roleGranted = false;
    if (!roles.some((r) => r.role === "admin")) {
      await ctx.db.insert("staffRoles", {
        organizationId: organization._id,
        userId,
        role: "admin",
        status: "active",
        grantedAt: now,
      });
      roleGranted = true;
    }

    // 5. Mark the account, open a 12-hour login, and record it.
    if (user.ssoManaged !== true) await ctx.db.patch(userId, { ssoManaged: true });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: now + SSO_SESSION_MS });
    await writeAudit(ctx, {
      property: { organizationId: organization._id },
      actorUserId: userId,
      action: "sso.signed_in",
      entityType: "users",
      entityId: userId,
      metadata: { hubAdminId, accountCreated, roleGranted },
    });
    return { userId, sessionId };
  },
});

/** Scheduled: forgets used tickets older than 10 minutes (they expired long before). */
export const deleteOldTickets = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - SSO_USED_TICKET_RETENTION_MS;
    const old = await ctx.db
      .query("ssoUsedTickets")
      .withIndex("by_usedAt", (q) => q.lt("usedAt", cutoff))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return null;
  },
});

/** The Admin Hub's address, for the "open it again from the Admin Hub" button. Not secret. */
export const hubOrigin = viewerQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async () => process.env.HUB_ORIGIN ?? null,
});
