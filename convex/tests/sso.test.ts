import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { SSO_SESSION_MS } from "../lib/ssoTicket";
import {
  createActiveResident,
  createProperty,
  createStaff,
  errorCode,
  setupTest,
  type T,
} from "./harness.test-utils";

const HUB = "https://admin.example.test";
const PHONE = "+919812345678";

let hubKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const hub = await generateKeyPair("EdDSA", { extractable: true });
  hubKey = hub.privateKey;
  otherKey = (await generateKeyPair("EdDSA", { extractable: true })).privateKey;
  // Stored the way it is on the real deployment: one line, "\n" written out.
  process.env.HUB_SSO_PUBLIC_KEY = (await exportSPKI(hub.publicKey)).trim().replace(/\n/g, "\\n");
  process.env.HUB_ORIGIN = HUB;
});

let jtiCounter = 0;

/** A ticket as the hub issues it; `overrides` changes claims (undefined removes one). */
async function ticket(overrides: JWTPayload = {}, key: CryptoKey = hubKey) {
  const now = Math.floor(Date.now() / 1000);
  jtiCounter += 1;
  const claims: JWTPayload = {
    iss: HUB,
    aud: "mealsync",
    sub: "hubAdmin123",
    phone: PHONE,
    name: "Meera Kapoor",
    role: "master_admin",
    jti: `nonce-${jtiCounter}`,
    iat: now,
    exp: now + 60,
    ...overrides,
  };
  for (const [k, value] of Object.entries(claims)) if (value === undefined) delete claims[k];
  return await new SignJWT(claims).setProtectedHeader({ alg: "EdDSA" }).sign(key);
}

const ssoSignIn = (t: T, value: string) =>
  t.action(api.auth.signIn, { provider: "hub-sso", params: { ticket: value } });

async function setup() {
  const t = await setupTest();
  const property = await createProperty(t);
  return { t, property };
}

async function rolesOf(t: T, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("staffRoles").withIndex("by_user_status", (q) => q.eq("userId", userId)).collect()).map(
      (r) => ({ role: r.role, status: r.status, propertyId: r.propertyId ?? null }),
    ),
  );
}

describe("Admin Hub sign-in (hub-sso)", () => {
  test("a valid ticket creates an Admin account and signs in for 12 hours", async () => {
    const { t, property } = await setup();
    const result = await ssoSignIn(t, await ticket());
    expect(result.tokens?.token).toBeTruthy();

    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ phone: PHONE, ssoManaged: true });
    const userId = users[0]._id;
    const profile = await t.run((ctx) => ctx.db.query("userProfiles").first());
    expect(profile).toMatchObject({ authUserId: userId, displayName: "Meera Kapoor", phone: PHONE, status: "active" });
    expect(await rolesOf(t, userId)).toEqual([{ role: "admin", status: "active", propertyId: null }]);
    const roles = await t.run((ctx) => ctx.db.query("staffRoles").collect());
    expect(roles[0].organizationId).toBe(property.organizationId);

    const sessions = await t.run((ctx) => ctx.db.query("authSessions").collect());
    expect(sessions).toHaveLength(1);
    expect(sessions[0].expirationTime - Date.now()).toBeLessThanOrEqual(SSO_SESSION_MS);
    expect(sessions[0].expirationTime - Date.now()).toBeGreaterThan(SSO_SESSION_MS - 60_000);

    const audit = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).filter((a) => a.action.startsWith("sso."));
    expect(audit.map((a) => a.action)).toEqual(["sso.signed_in"]);
    expect(audit[0].metadata).toMatchObject({ hubAdminId: "hubAdmin123", accountCreated: true, roleGranted: true });

    const as = t.withIdentity({ subject: `${userId}|${sessions[0]._id}` });
    const me = await as.query(api.users.me, {});
    expect(me?.staff?.isAdmin).toBe(true);
  });

  test("the login ends after 12 hours", async () => {
    const { t } = await setup();
    await ssoSignIn(t, await ticket());
    const session = (await t.run((ctx) => ctx.db.query("authSessions").first()))!;
    const as = t.withIdentity({ subject: `${session.userId}|${session._id}` });
    expect(await as.query(api.users.me, {})).not.toBeNull();
    await t.run((ctx) => ctx.db.patch(session._id, { expirationTime: Date.now() - 1 }));
    expect(await as.query(api.users.me, {})).toBeNull();
  });

  test("an existing Admin signs in without getting a second role", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin", "Existing Admin");
    await ssoSignIn(t, await ticket({ phone: admin.phone }));
    expect(await rolesOf(t, admin.userId)).toEqual([{ role: "admin", status: "active", propertyId: null }]);
    const profile = await t.run((ctx) => ctx.db.query("userProfiles").first());
    expect(profile?.displayName).toBe("Existing Admin");
  });

  test("a Warden with the same number gains Admin and keeps their Warden properties", async () => {
    const { t, property } = await setup();
    const warden = await createStaff(t, "warden", "Ward En");
    const before = await t.run((ctx) => ctx.db.query("userProfiles").first());
    await ssoSignIn(t, await ticket({ phone: warden.phone }));
    expect(await rolesOf(t, warden.userId)).toEqual([
      { role: "warden", status: "active", propertyId: property._id },
      { role: "admin", status: "active", propertyId: null },
    ]);
    expect(await t.run((ctx) => ctx.db.query("userProfiles").first())).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });

  test("a resident with the same number gains Admin; their resident record is untouched", async () => {
    const { t } = await setup();
    const resident = await createActiveResident(t, "Ravi", "305");
    const before = await t.run(async (ctx) => ({
      resident: await ctx.db.get(resident.residentId),
      profile: await ctx.db.query("userProfiles").first(),
    }));
    await ssoSignIn(t, await ticket({ phone: resident.phone }));
    const after = await t.run(async (ctx) => ({
      resident: await ctx.db.get(resident.residentId),
      profile: await ctx.db.query("userProfiles").first(),
    }));
    expect(after).toEqual(before);
    expect(await rolesOf(t, resident.userId)).toEqual([{ role: "admin", status: "active", propertyId: null }]);
  });

  test("a switched-off account is refused and left as it is", async () => {
    const { t } = await setup();
    const warden = await createStaff(t, "warden");
    await t.run(async (ctx) => {
      const profile = (await ctx.db.query("userProfiles").first())!;
      await ctx.db.patch(profile._id, { status: "inactive" });
    });
    expect(await errorCode(ssoSignIn(t, await ticket({ phone: warden.phone })))).toBe("SSO_LINK_EXPIRED");
    expect((await rolesOf(t, warden.userId)).map((r) => r.role)).toEqual(["warden"]);
    const user = await t.run((ctx) => ctx.db.get(warden.userId));
    expect(user?.ssoManaged).toBeUndefined();
  });

  test("expired, wrong-audience, wrong-issuer, tampered, wrong-role and foreign-key tickets are refused", async () => {
    const { t } = await setup();
    const now = Math.floor(Date.now() / 1000);
    const valid = await ticket();
    const [header, payload, signature] = valid.split(".");
    const forged = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    forged.phone = "+919800000000";
    const tamperedPayload = btoa(JSON.stringify(forged)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const bad: Record<string, string> = {
      expired: await ticket({ iat: now - 100, exp: now - 40 }),
      wrongAudience: await ticket({ aud: "staff" }),
      wrongIssuer: await ticket({ iss: "https://evil.example.test" }),
      tampered: `${header}.${tamperedPayload}.${signature}`,
      wrongRole: await ticket({ role: "admin" }),
      noRole: await ticket({ role: undefined }),
      foreignKey: await ticket({}, otherKey),
      noJti: await ticket({ jti: undefined }),
      empty: "",
      garbage: "not-a-ticket",
    };
    for (const [name, value] of Object.entries(bad)) {
      expect(await errorCode(ssoSignIn(t, value)), name).toBe("SSO_LINK_EXPIRED");
    }
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toHaveLength(0);
  });

  test("a ticket only 20 seconds past its expiry is still accepted (clock allowance)", async () => {
    const { t } = await setup();
    const now = Math.floor(Date.now() / 1000);
    const result = await ssoSignIn(t, await ticket({ iat: now - 80, exp: now - 20 }));
    expect(result.tokens?.token).toBeTruthy();
  });

  test("a ticket can be used only once", async () => {
    const { t } = await setup();
    const value = await ticket();
    expect((await ssoSignIn(t, value)).tokens?.token).toBeTruthy();
    expect(await errorCode(ssoSignIn(t, value))).toBe("SSO_LINK_EXPIRED");
    expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toHaveLength(1);
  });

  test("used tickets are forgotten after 10 minutes", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("ssoUsedTickets", { jti: "old", usedAt: Date.now() - 11 * 60_000 });
      await ctx.db.insert("ssoUsedTickets", { jti: "recent", usedAt: Date.now() - 60_000 });
    });
    await t.mutation(internal.sso.deleteOldTickets, {});
    const left = await t.run((ctx) => ctx.db.query("ssoUsedTickets").collect());
    expect(left.map((r) => r.jti)).toEqual(["recent"]);
  });

  test("without the hub's settings every ticket is refused", async () => {
    const { t } = await setup();
    const saved = process.env.HUB_SSO_PUBLIC_KEY;
    delete process.env.HUB_SSO_PUBLIC_KEY;
    try {
      expect(await errorCode(ssoSignIn(t, await ticket()))).toBe("SSO_LINK_EXPIRED");
    } finally {
      process.env.HUB_SSO_PUBLIC_KEY = saved;
    }
  });

  test("normal phone + password sign-in still works for an account that also uses the hub", async () => {
    const { t, property } = await setup();
    await t.action(api.auth.signIn, {
      provider: "phone-password",
      params: { flow: "signUp", phone: PHONE, password: "plain-tea-42", displayName: "Meera", roomNumber: "101", propertyId: property._id },
    });
    await ssoSignIn(t, await ticket());
    const result = await t.action(api.auth.signIn, {
      provider: "phone-password",
      params: { flow: "signIn", phone: PHONE, password: "plain-tea-42" },
    });
    expect(result.tokens?.token).toBeTruthy();
  });
});

/** A "Revoke in all apps" token as the hub signs it. */
const revokeToken = (overrides: JWTPayload = {}, key: CryptoKey = hubKey) =>
  ticket({ aud: "mealsync-revoke", role: undefined, name: undefined, ...overrides }, key);

const callRevoke = (t: T, token?: string) =>
  t.fetch("/sso/revoke", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function hubSession(t: T, userId: Id<"users">) {
  return (await t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect())).filter(
    (s) => Math.abs(s.expirationTime - s._creationTime - SSO_SESSION_MS) <= 60_000,
  );
}

describe("Revoke in all apps (/sso/revoke)", () => {
  test("ends the hub login and removes the Admin role the hub gave", async () => {
    const { t } = await setup();
    await ssoSignIn(t, await ticket());
    const user = (await t.run((ctx) => ctx.db.query("users").first()))!;
    const [session] = await hubSession(t, user._id);
    const as = t.withIdentity({ subject: `${user._id}|${session._id}` });
    expect((await as.query(api.users.me, {}))?.hubLink).toBe(HUB);

    const response = await callRevoke(t, await revokeToken());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sessionsEnded: 1, adminRemoved: true });

    expect(await as.query(api.users.me, {})).toBeNull();
    expect(await rolesOf(t, user._id)).toEqual([{ role: "admin", status: "inactive", propertyId: null }]);
    expect((await t.run((ctx) => ctx.db.get(user._id)))?.ssoManaged).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("authRefreshTokens").collect())).toHaveLength(0);
    const audit = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).map((a) => a.action);
    expect(audit).toContain("sso.access_revoked");
  });

  test("a Warden keeps their Warden role; only the hub's Admin role goes", async () => {
    const { t, property } = await setup();
    const warden = await createStaff(t, "warden");
    await ssoSignIn(t, await ticket({ phone: warden.phone }));
    await callRevoke(t, await revokeToken({ phone: warden.phone }));
    expect(await rolesOf(t, warden.userId)).toEqual([
      { role: "warden", status: "active", propertyId: property._id },
      { role: "admin", status: "inactive", propertyId: null },
    ]);
    // Their own login (made before the hub sign-in) still works.
    expect(await warden.as.query(api.users.me, {})).not.toBeNull();
  });

  test("an Admin role the person already had in Dine is kept, as is their own login", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin");
    await ssoSignIn(t, await ticket({ phone: admin.phone }));
    expect(await hubSession(t, admin.userId)).toHaveLength(1);
    const response = await callRevoke(t, await revokeToken({ phone: admin.phone }));
    expect(await response.json()).toEqual({ ok: true, sessionsEnded: 1, adminRemoved: false });
    expect(await hubSession(t, admin.userId)).toHaveLength(0);
    expect(await rolesOf(t, admin.userId)).toEqual([{ role: "admin", status: "active", propertyId: null }]);
    expect((await admin.as.query(api.users.me, {}))?.staff?.isAdmin).toBe(true);
  });

  test("accounts that never used the hub are not touched", async () => {
    const { t } = await setup();
    const admin = await createStaff(t, "admin");
    const before = await t.run(async (ctx) => ({ users: await ctx.db.query("users").collect(), roles: await ctx.db.query("staffRoles").collect() }));
    const response = await callRevoke(t, await revokeToken({ phone: admin.phone }));
    expect(await response.json()).toEqual({ ok: true, sessionsEnded: 0, adminRemoved: false });
    const after = await t.run(async (ctx) => ({ users: await ctx.db.query("users").collect(), roles: await ctx.db.query("staffRoles").collect() }));
    expect(after).toEqual(before);
    expect((await admin.as.query(api.users.me, {}))?.hubLink).toBeNull();
  });

  test("unsigned, wrong-audience, foreign-key, expired and reused requests are refused and change nothing", async () => {
    const { t } = await setup();
    await ssoSignIn(t, await ticket());
    const now = Math.floor(Date.now() / 1000);
    const reused = await revokeToken();
    await callRevoke(t, reused);
    await ssoSignIn(t, await ticket()); // signed in again, admin role back via a new grant

    const before = await t.run(async (ctx) => ({
      sessions: await ctx.db.query("authSessions").collect(),
      roles: await ctx.db.query("staffRoles").collect(),
    }));
    const bad: Record<string, string | undefined> = {
      none: undefined,
      signInTicket: await ticket(),
      otherApp: await revokeToken({ aud: "staff-revoke" }),
      wrongIssuer: await revokeToken({ iss: "https://evil.example.test" }),
      foreignKey: await revokeToken({}, otherKey),
      expired: await revokeToken({ iat: now - 100, exp: now - 40 }),
      reused,
    };
    for (const [name, token] of Object.entries(bad)) {
      const response = await callRevoke(t, token);
      expect(response.status, name).toBe(401);
      expect(await response.json(), name).toEqual({ ok: false });
    }
    const after = await t.run(async (ctx) => ({
      sessions: await ctx.db.query("authSessions").collect(),
      roles: await ctx.db.query("staffRoles").collect(),
    }));
    expect(after).toEqual(before);
  });
});
