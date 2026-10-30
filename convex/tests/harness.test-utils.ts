/// <reference types="vite/client" />
// Shared helpers for backend tests. The double extension keeps Convex from
// deploying this file as a backend module.
import { convexTest } from "convex-test";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import type { StaffRole } from "../lib/validators";

export const modules = import.meta.glob("../**/*.ts");

/** Keys Convex Auth needs to issue login tokens inside tests. */
async function configureAuthEnv() {
  if (process.env.JWT_PRIVATE_KEY) return;
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  process.env.JWT_PRIVATE_KEY = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });
  process.env.CONVEX_SITE_URL = "https://test.convex.site";
  process.env.SITE_URL = "http://localhost:3000";
}

export async function setupTest() {
  await configureAuthEnv();
  const t = convexTest(schema, modules);
  return t;
}

export type T = Awaited<ReturnType<typeof setupTest>>;

export async function createProperty(t: T) {
  await t.mutation(internal.setup.createProperty, {
    organizationName: "Test Org",
    propertyName: "Test PG",
  });
  return await t.run(async (ctx) => (await ctx.db.query("properties").first())!);
}

let phoneCounter = 0;
function nextPhone() {
  phoneCounter += 1;
  return `+9198${String(phoneCounter).padStart(8, "0")}`;
}

/** Inserts a login (users row) directly and returns a client acting as it. */
export async function createLogin(t: T, phone = nextPhone()) {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { phone }));
  const sessionId = await t.run(async (ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 }),
  );
  const as = t.withIdentity({ subject: `${userId}|${sessionId}` });
  return { userId, phone, as };
}

/** Another property in the first organisation. */
export async function addProperty(t: T, name: string) {
  return await t.run(async (ctx) => {
    const { createProperty } = await import("../lib/property");
    const first = (await ctx.db.query("properties").first())!;
    return await createProperty(ctx, { organizationId: first.organizationId, name, createdBy: undefined });
  });
}

const firstPropertyId = (t: T) => t.run(async (ctx) => (await ctx.db.query("properties").first())!._id);

/** A signed-up person who has completed their profile (pending resident), at `propertyId` (default: the first property). */
export async function createSignedUp(t: T, name = "Test Person", room = "101", propertyId?: Id<"properties">) {
  const login = await createLogin(t);
  const { api } = await import("../_generated/api");
  await login.as.mutation(api.users.completeProfile, {
    displayName: name,
    roomNumber: room,
    propertyId: propertyId ?? (await firstPropertyId(t)),
  });
  const residentId = await t.run(async (ctx) => {
    const r = await ctx.db
      .query("residents")
      .withIndex("by_user", (q) => q.eq("userId", login.userId))
      .unique();
    return r!._id;
  });
  return { ...login, residentId };
}

export async function createActiveResident(t: T, name = "Active Resident", room = "201", propertyId?: Id<"properties">) {
  const person = await createSignedUp(t, name, room, propertyId);
  await t.run(async (ctx) => {
    await ctx.db.patch(person.residentId, { status: "active", validFrom: "2026-01-01" });
  });
  return person;
}

/** A staff member. Admins cover the whole organisation; a Warden gets `propertyIds` (default: the first property). */
export async function createStaff(t: T, role: StaffRole, name = `Staff ${role}`, propertyIds?: Id<"properties">[]) {
  const login = await createLogin(t);
  const propertyId = await t.run(async (ctx) => {
    const property = (await ctx.db.query("properties").first())!;
    await ctx.db.insert("userProfiles", {
      authUserId: login.userId,
      displayName: name,
      phone: login.phone,
      status: "active",
      createdAt: Date.now(),
    });
    for (const propertyId of role === "admin" ? [undefined] : (propertyIds ?? [property._id])) {
      await ctx.db.insert("staffRoles", {
        organizationId: property.organizationId,
        propertyId,
        userId: login.userId,
        role,
        status: "active",
        grantedAt: Date.now(),
      });
    }
    return property._id;
  });
  return { ...login, propertyId: propertyId as Id<"properties"> };
}

/** The ConvexError code thrown by `promise`, or "NO_ERROR". */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) return String(data.code);
    return `UNEXPECTED: ${(error as Error).message}`;
  }
}
