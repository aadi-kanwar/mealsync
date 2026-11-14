import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { writeAudit } from "./audit";
import { getProfile, getResidentRecord } from "./functions";
import { createOrganization, createProperty } from "./property";
import type { HubPerson, HubPropertyRef } from "./ssoTicket";
import { localDateString } from "./time";

/**
 * Livoza Hub: the hub owns people, their profile types and properties. This
 * file makes Dine match what the hub says ("make it so"), for a sign-in
 * ticket or a sync from the hub. Running it twice changes nothing more.
 *
 * Roles the hub gives in Dine (its tools.config.ts): admin, warden, resident.
 * Anything else, or no role, means no access here: Dine roles and the
 * resident stay are switched off, but history (meals, records) is kept.
 */

type Db = Pick<MutationCtx, "db">;

export const DINE_ROLES = ["admin", "warden", "resident"] as const;
export type DineRole = (typeof DINE_ROLES)[number];

export function asDineRole(role: string | null): DineRole | null {
  return (DINE_ROLES as readonly string[]).includes(role ?? "") ? (role as DineRole) : null;
}

/** Dine runs a single organisation: the oldest active one (made if there's none yet). */
export async function theOrganization(ctx: Db, name = "Livoza"): Promise<Doc<"organizations">> {
  const existing = await ctx.db
    .query("organizations")
    .filter((q) => q.eq(q.field("status"), "active"))
    .order("asc")
    .first();
  return existing ?? (await createOrganization(ctx, { name, createdBy: undefined }));
}

/**
 * The Dine property for a hub property: already linked, or the row the
 * hub's import matched (`toolPropertyId`), or an unlinked one with the same
 * name, or a new one. Keeps its name the same as the hub's.
 */
export async function ensureHubProperty(
  ctx: Db,
  ref: HubPropertyRef,
  options: { toolPropertyId?: string | null; organizationName?: string } = {},
): Promise<Doc<"properties">> {
  const linked = await ctx.db
    .query("properties")
    .withIndex("by_hubPropertyId", (q) => q.eq("hubPropertyId", ref.id))
    .first();
  let property = linked;
  if (property === null && options.toolPropertyId) {
    const id = ctx.db.normalizeId("properties", options.toolPropertyId);
    const row = id ? await ctx.db.get(id) : null;
    if (row !== null && row.hubPropertyId === undefined) property = row;
  }
  const organization = property
    ? ((await ctx.db.get(property.organizationId)) ?? (await theOrganization(ctx, options.organizationName)))
    : await theOrganization(ctx, options.organizationName);
  if (property === null) {
    property =
      (
        await ctx.db
          .query("properties")
          .withIndex("by_org_status", (q) => q.eq("organizationId", organization._id).eq("status", "active"))
          .collect()
      ).find((p) => p.hubPropertyId === undefined && p.name.trim().toLowerCase() === ref.name.trim().toLowerCase()) ??
      null;
  }
  if (property === null) {
    property = await createProperty(ctx, { organizationId: organization._id, name: ref.name, createdBy: undefined });
  }
  const patch: Partial<Doc<"properties">> = {};
  if (property.hubPropertyId !== ref.id) patch.hubPropertyId = ref.id;
  if (ref.name.length > 0 && property.name !== ref.name) {
    const clash = (
      await ctx.db
        .query("properties")
        .withIndex("by_org_status", (q) => q.eq("organizationId", property!.organizationId).eq("status", "active"))
        .collect()
    ).some((p) => p._id !== property!._id && p.name.toLowerCase() === ref.name.toLowerCase());
    if (!clash) patch.name = ref.name;
  }
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(property._id, patch);
    if (patch.hubPropertyId) {
      await writeAudit(ctx, {
        property,
        actorUserId: undefined,
        action: "hub.property_linked",
        entityType: "properties",
        entityId: property._id,
        metadata: { hubPropertyId: ref.id },
      });
    }
  }
  return (await ctx.db.get(property._id))!;
}

/** The Dine account for a hub person: by hub id, then by phone. */
async function findUser(ctx: Db, person: Pick<HubPerson, "hubUserId" | "phone">): Promise<Doc<"users"> | null> {
  const byHub = await ctx.db
    .query("users")
    .withIndex("by_hubUserId", (q) => q.eq("hubUserId", person.hubUserId))
    .first();
  if (byHub !== null) return byHub;
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_phone", (q) => q.eq("phone", person.phone))
    .first();
  if (profile !== null) return await ctx.db.get(profile.authUserId);
  return await ctx.db
    .query("users")
    .withIndex("phone", (q) => q.eq("phone", person.phone))
    .first();
}

/** Ends every Dine login of this account (and its refresh tokens). */
export async function endSessions(ctx: Db, userId: Id<"users">): Promise<number> {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);
    await ctx.db.delete(session._id);
  }
  return sessions.length;
}

/**
 * Makes Dine match the hub for one person. Returns their Dine account, or
 * null when they have no Dine account and no access (nothing to do).
 */
export async function applyHubPerson(
  ctx: Db,
  person: HubPerson,
  options: { active: boolean; revoke: boolean },
): Promise<Id<"users"> | null> {
  const now = Date.now();
  const role = options.active ? asDineRole(person.role) : null;
  let user = await findUser(ctx, person);
  if (user === null) {
    if (role === null) return null;
    const userId = await ctx.db.insert("users", { phone: person.phone, name: person.name, hubUserId: person.hubUserId, ssoManaged: true });
    user = (await ctx.db.get(userId))!;
  } else if (user.hubUserId !== person.hubUserId || user.ssoManaged !== true || user.name !== person.name) {
    await ctx.db.patch(user._id, { hubUserId: person.hubUserId, ssoManaged: true, name: person.name });
  }
  const userId = user._id;

  // Profile: the hub's name; switched off without Dine access.
  const profile = await getProfile(ctx, userId);
  if (profile === null) {
    if (role !== null) {
      await ctx.db.insert("userProfiles", {
        authUserId: userId,
        displayName: person.name,
        phone: person.phone,
        status: "active",
        createdAt: now,
      });
    }
  } else {
    const status = role === null ? "inactive" : "active";
    if (profile.displayName !== person.name || profile.status !== status || profile.mustChangePassword) {
      await ctx.db.patch(profile._id, { displayName: person.name, status, mustChangePassword: undefined });
    }
  }

  // Properties the hub names (made or linked here if Dine doesn't have them yet).
  const refs = person.properties === "all" ? [] : person.properties;
  const properties: Doc<"properties">[] = [];
  for (const ref of refs) properties.push(await ensureHubProperty(ctx, ref));
  const organization = properties[0]
    ? ((await ctx.db.get(properties[0].organizationId)) ?? (await theOrganization(ctx)))
    : await theOrganization(ctx);

  // Staff roles: exactly what the role says.
  const staffRows = await ctx.db
    .query("staffRoles")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
    .collect();
  const keep = new Set<Id<"staffRoles">>();
  if (role === "admin") {
    const admin = staffRows.find((r) => r.role === "admin" && r.organizationId === organization._id);
    if (admin) keep.add(admin._id);
    else {
      await ctx.db.insert("staffRoles", { organizationId: organization._id, userId, role: "admin", status: "active", grantedAt: now });
    }
  } else if (role === "warden") {
    for (const property of properties) {
      const row = staffRows.find((r) => r.role === "warden" && r.propertyId === property._id);
      if (row) keep.add(row._id);
      else {
        await ctx.db.insert("staffRoles", {
          organizationId: property.organizationId,
          propertyId: property._id,
          userId,
          role: "warden",
          status: "active",
          grantedAt: now,
        });
      }
    }
  }
  for (const row of staffRows) {
    if (!keep.has(row._id)) await ctx.db.patch(row._id, { status: "inactive", revokedAt: now });
  }

  // The resident stay: one active stay at the hub's property, or none.
  const stays = (
    await ctx.db
      .query("residents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
  ).filter((r) => r.status === "active" || r.status === "pending");
  const home = role === "resident" ? properties[0] : undefined;
  for (const stay of stays) {
    if (home !== undefined && stay.propertyId === home._id) continue;
    const property = await ctx.db.get(stay.propertyId);
    const today = localDateString(now, property?.timezone ?? "Asia/Kolkata");
    await ctx.db.patch(stay._id, {
      status: "inactive",
      validUntil: stay.status === "active" ? (stay.validUntil ?? today) : stay.validUntil,
    });
  }
  if (home !== undefined) {
    const today = localDateString(now, home.timezone);
    const current = stays.find((s) => s.propertyId === home._id);
    const roomNumber = person.roomNumber ?? current?.roomNumber ?? (await getResidentRecord(ctx, userId))?.roomNumber ?? "";
    if (current) {
      await ctx.db.patch(current._id, {
        status: "active",
        displayName: person.name,
        roomNumber,
        validFrom: current.validFrom ?? today,
        validUntil: undefined,
        approvedAt: current.approvedAt ?? now,
      });
    } else {
      await ctx.db.insert("residents", {
        organizationId: home.organizationId,
        propertyId: home._id,
        userId,
        displayName: person.name,
        roomNumber,
        validFrom: today,
        status: "active",
        createdAt: now,
        approvedAt: now,
      });
    }
  }

  let sessionsEnded = 0;
  if (options.revoke || role === null) sessionsEnded = await endSessions(ctx, userId);

  await writeAudit(ctx, {
    property: properties[0] ?? { organizationId: organization._id },
    actorUserId: undefined,
    action: "hub.person_synced",
    entityType: "users",
    entityId: userId,
    metadata: { hubUserId: person.hubUserId, role, sessionsEnded },
  });
  return userId;
}

/**
 * Everyone and every property in Dine, for the hub's one-time import. Each
 * person's Dine role is already turned into a hub profile type. Password
 * hashes go only to the hub (which uses the same hashing).
 */
export async function exportForHub(ctx: Pick<QueryCtx, "db">) {
  const properties = (await ctx.db.query("properties").withIndex("by_status", (q) => q.eq("status", "active")).collect()).map(
    (p) => ({ toolPropertyId: p._id as string, name: p.name, hubPropertyId: p.hubPropertyId ?? null }),
  );
  const people = [];
  for (const profile of await ctx.db.query("userProfiles").collect()) {
    const userId = profile.authUserId;
    const roles = await ctx.db
      .query("staffRoles")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .collect();
    const stay = (
      await ctx.db
        .query("residents")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).find((r) => r.status === "active");
    let hubType: "admin" | "warden" | "resident" | null = null;
    let toolPropertyIds: string[] = [];
    if (roles.some((r) => r.role === "admin")) hubType = "admin";
    else if (roles.some((r) => r.role === "warden")) {
      hubType = "warden";
      toolPropertyIds = roles.flatMap((r) => (r.propertyId ? [r.propertyId as string] : []));
    } else if (stay) {
      hubType = "resident";
      toolPropertyIds = [stay.propertyId as string];
    }
    if (hubType === null) continue;
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "phone-password").eq("providerAccountId", profile.phone))
      .first();
    people.push({
      phone: profile.phone,
      name: profile.displayName,
      hubType,
      toolPropertyIds,
      active: profile.status === "active",
      passwordHash: account?.secret ?? null,
      roomNumber: stay?.roomNumber ?? null,
    });
  }
  return { properties, people };
}
