import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createActiveResident, createProperty, createStaff, errorCode, setupTest, type T } from "./harness.test-utils";

/** The Livoza Hub for everyone: tickets for any profile type, sync, export, hub-only sign-in. */

const HUB = "https://hub.example.test";
let hubKey: CryptoKey;

beforeAll(async () => {
  const hub = await generateKeyPair("EdDSA", { extractable: true });
  hubKey = hub.privateKey;
  process.env.HUB_SSO_PUBLIC_KEY = (await exportSPKI(hub.publicKey)).trim().replace(/\n/g, "\\n");
  process.env.HUB_ORIGIN = HUB;
});

afterEach(() => {
  delete process.env.HUB_ONLY;
});

let counter = 0;
async function sign(claims: JWTPayload, audience: string, sub: string) {
  const now = Math.floor(Date.now() / 1000);
  counter += 1;
  return await new SignJWT({ ...claims, iss: HUB, aud: audience, sub, jti: `j-${counter}`, iat: now, exp: now + 60 })
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(hubKey);
}

const person = (overrides: JWTPayload = {}) => ({
  phone: "+919811111111",
  name: "Riya Sen",
  profileType: "resident",
  role: "resident",
  roomNumber: "12",
  properties: [{ id: "hubP1", name: "Test PG" }],
  ...overrides,
});

const ssoSignIn = async (t: T, claims: JWTPayload, sub = "hubU1") =>
  t.action(api.auth.signIn, { provider: "hub-sso", params: { ticket: await sign(claims, "mealsync", sub) } });

async function postSync(t: T, claims: JWTPayload, sub: string) {
  const token = await sign(claims, "mealsync-sync", sub);
  return await t.fetch("/sso/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

async function userByHub(t: T, hubUserId: string) {
  return await t.run(async (ctx) =>
    ctx.db.query("users").withIndex("by_hubUserId", (q) => q.eq("hubUserId", hubUserId)).first(),
  );
}

async function stays(t: T, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("residents").withIndex("by_user", (q) => q.eq("userId", userId)).collect()).map((r) => ({
      propertyId: r.propertyId,
      status: r.status,
      roomNumber: r.roomNumber,
    })),
  );
}

async function activeRoles(t: T, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("staffRoles").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active")).collect()).map(
      (r) => [r.role, r.propertyId ?? null],
    ),
  );
}

describe("tickets for every profile type", () => {
  test("a resident from the hub is an active resident at once, linked to the existing property by name", async () => {
    const t = await setupTest();
    const property = await createProperty(t);
    expect((await ssoSignIn(t, person())).tokens?.token).toBeTruthy();
    const user = (await userByHub(t, "hubU1"))!;
    expect(await stays(t, user._id)).toEqual([{ propertyId: property._id, status: "active", roomNumber: "12" }]);
    expect((await t.run((ctx) => ctx.db.get(property._id)))?.hubPropertyId).toBe("hubP1");
    const session = (await t.run((ctx) => ctx.db.query("authSessions").first()))!;
    const me = await t.withIdentity({ subject: `${user._id}|${session._id}` }).query(api.users.me, {});
    expect(me?.resident?.status).toBe("active");
  });

  test("a warden gets exactly the hub's properties; an existing account is matched by phone", async () => {
    const t = await setupTest();
    const property = await createProperty(t);
    const resident = await createActiveResident(t, "Was Resident");
    await ssoSignIn(t, person({ phone: resident.phone, profileType: "warden", role: "warden" }));
    expect(await activeRoles(t, resident.userId)).toEqual([["warden", property._id]]);
    expect((await stays(t, resident.userId)).every((s) => s.status === "inactive")).toBe(true);
  });

  test("a role Dine doesn't know is refused", async () => {
    const t = await setupTest();
    await createProperty(t);
    expect(await errorCode(ssoSignIn(t, person({ profileType: "staff", role: "staff" })))).toBe("SSO_LINK_EXPIRED");
    expect(await errorCode(ssoSignIn(t, person({ role: "superuser" })))).toBe("SSO_LINK_EXPIRED");
  });
});

describe("sync from the hub", () => {
  test("moves a resident to a new property (made in Dine) and ends their logins", async () => {
    const t = await setupTest();
    const property = await createProperty(t);
    await ssoSignIn(t, person());
    const user = (await userByHub(t, "hubU1"))!;
    const response = await postSync(
      t,
      { kind: "person", ...person({ properties: [{ id: "hubP2", name: "Blue PG" }] }), active: true, revoke: true },
      "hubU1",
    );
    expect(response.status).toBe(200);
    const blue = await t.run(async (ctx) =>
      ctx.db.query("properties").withIndex("by_hubPropertyId", (q) => q.eq("hubPropertyId", "hubP2")).first(),
    );
    expect(blue?.name).toBe("Blue PG");
    expect(await stays(t, user._id)).toEqual([
      { propertyId: property._id, status: "inactive", roomNumber: "12" },
      { propertyId: blue!._id, status: "active", roomNumber: "12" },
    ]);
    expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toEqual([]);
  });

  test("switched off in the hub: no roles, profile off, history kept", async () => {
    const t = await setupTest();
    await createProperty(t);
    const warden = await createStaff(t, "warden", "Wanda");
    await postSync(t, { kind: "person", ...person({ phone: warden.phone, profileType: "warden", role: "warden" }), active: false, revoke: true }, "hubW");
    expect(await activeRoles(t, warden.userId)).toEqual([]);
    const profile = await t.run((ctx) => ctx.db.query("userProfiles").first());
    expect(profile?.status).toBe("inactive");
    expect((await t.run((ctx) => ctx.db.get(warden.userId)))?.hubUserId).toBe("hubW");
  });

  test("a property sync links the row the import matched and renames it", async () => {
    const t = await setupTest();
    const property = await createProperty(t);
    const response = await postSync(
      t,
      { kind: "property", property: { id: "hubP9", name: "Renamed PG", organizationName: "Livoza", active: true }, toolPropertyId: property._id },
      "hubP9",
    );
    expect(response.status).toBe(200);
    expect(await t.run((ctx) => ctx.db.get(property._id))).toMatchObject({ hubPropertyId: "hubP9", name: "Renamed PG" });
  });

  test("an unsigned, wrongly addressed or replayed request is refused", async () => {
    const t = await setupTest();
    await createProperty(t);
    expect((await t.fetch("/sso/sync", { method: "POST" })).status).toBe(401);
    const wrong = await sign({ kind: "person", ...person(), active: true, revoke: false }, "staff-sync", "hubU1");
    expect((await t.fetch("/sso/sync", { method: "POST", headers: { Authorization: `Bearer ${wrong}` } })).status).toBe(401);
    const token = await sign({ kind: "person", ...person(), active: true, revoke: false }, "mealsync-sync", "hubU1");
    const init = { method: "POST", headers: { Authorization: `Bearer ${token}` } };
    expect((await t.fetch("/sso/sync", init)).status).toBe(200);
    expect((await t.fetch("/sso/sync", init)).status).toBe(401);
  });
});

describe("export for the hub's import", () => {
  test("lists properties and people with hub types and password hashes", async () => {
    const t = await setupTest();
    const property = await createProperty(t);
    await createStaff(t, "admin", "Ada Admin");
    const warden = await createStaff(t, "warden", "Wanda");
    const resident = await createActiveResident(t, "Ravi", "305");
    await t.run((ctx) =>
      ctx.db.insert("authAccounts", { userId: resident.userId, provider: "phone-password", providerAccountId: resident.phone, secret: "hash-r" }),
    );
    const token = await sign({}, "mealsync-export", "import");
    const response = await t.fetch("/sso/export", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.properties).toEqual([{ toolPropertyId: property._id, name: "Test PG", hubPropertyId: null }]);
    expect(body.people).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Ada Admin", hubType: "admin", toolPropertyIds: [] }),
        expect.objectContaining({ phone: warden.phone, hubType: "warden", toolPropertyIds: [property._id] }),
        expect.objectContaining({ phone: resident.phone, hubType: "resident", roomNumber: "305", passwordHash: "hash-r" }),
      ]),
    );
    expect((await t.fetch("/sso/export", { method: "POST" })).status).toBe(401);
  });
});

test("with HUB_ONLY, Dine's own sign-in sends people to the hub", async () => {
  const t = await setupTest();
  await createProperty(t);
  process.env.HUB_ONLY = "true";
  const result = await errorCode(
    t.action(api.auth.signIn, { provider: "phone-password", params: { flow: "signIn", phone: "+919811111111", password: "whatever-1" } }),
  );
  expect(result).toBe("USE_HUB");
  expect(await t.query(api.sso.hubSettings, {})).toEqual({ hubOnly: true, openUrl: `${HUB}/open/mealsync` });
});
