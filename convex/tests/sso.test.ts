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
