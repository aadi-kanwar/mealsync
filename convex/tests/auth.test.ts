import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { FAILED_ATTEMPTS_LIMIT, FAILED_ATTEMPTS_WINDOW_MS, SIGNUPS_PER_HOUR_LIMIT } from "../authLimits";
import { createProperty, errorCode, setupTest, type T } from "./harness.test-utils";

const PASSWORD = "plain-tea-42";

function signIn(
  t: T,
  flow: "signIn" | "signUp",
  phone: string,
  password: string,
  profile: { displayName?: string; roomNumber?: string } = { displayName: "Asha Rao", roomNumber: "204" },
) {
  return t.action(api.auth.signIn, {
    provider: "phone-password",
    params: flow === "signUp" ? { flow, phone, password, ...profile } : { flow, phone, password },
  });
}

async function setup() {
  const t = await setupTest();
  await createProperty(t);
  return t;
}

describe("phone + password sign-up and sign-in", () => {
  test("sign-up stores the number in international format and returns a session", async () => {
    const t = await setup();
    const result = await signIn(t, "signUp", "98765 43210", PASSWORD);
    expect(result.tokens?.token).toBeTruthy();
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users.map((u) => u.phone)).toEqual(["+919876543210"]);
  });

  test("different ways of writing the same number reach the same account", async () => {
    const t = await setup();
    await signIn(t, "signUp", "+91 98765-43210", PASSWORD);
    for (const written of ["9876543210", "09876543210", "+919876543210", "(98765) 43210"]) {
      const result = await signIn(t, "signIn", written, PASSWORD);
      expect(result.tokens?.token, written).toBeTruthy();
    }
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });

  test("invalid phone numbers and weak passwords are refused", async () => {
    const t = await setup();
    expect(await errorCode(signIn(t, "signUp", "12345", PASSWORD))).toBe("INVALID_PHONE");
    expect(await errorCode(signIn(t, "signUp", "9876543210", "short"))).toBe("WEAK_PASSWORD");
    expect(await errorCode(signIn(t, "signUp", "9876543210", "aaaaaaaaaa"))).toBe("WEAK_PASSWORD");
    expect(await errorCode(signIn(t, "signUp", "9876543210", "my9876543210"))).toBe(
      "WEAK_PASSWORD",
    );
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
  });

  test("wrong password and unknown number give the same error (no hint who is registered)", async () => {
    const t = await setup();
    await signIn(t, "signUp", "9876543210", PASSWORD);
    expect(await errorCode(signIn(t, "signIn", "9876543210", "wrong-password"))).toBe(
      "SIGN_IN_FAILED",
    );
    expect(await errorCode(signIn(t, "signIn", "9123456780", PASSWORD))).toBe("SIGN_IN_FAILED");
  });

  test("signing up with a registered number: right password signs in, wrong one fails generically", async () => {
    const t = await setup();
    await signIn(t, "signUp", "9876543210", PASSWORD);
    const again = await signIn(t, "signUp", "9876543210", PASSWORD);
    expect(again.tokens?.token).toBeTruthy();
    expect(await errorCode(signIn(t, "signUp", "9876543210", "other-password"))).toBe(
      "SIGN_IN_FAILED",
    );
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });

  test("the password is stored hashed, never in plain text", async () => {
    const t = await setup();
    await signIn(t, "signUp", "9876543210", PASSWORD);
    const dump = JSON.stringify(
      await t.run(async (ctx) => ({
        accounts: await ctx.db.query("authAccounts").collect(),
        audit: await ctx.db.query("auditLogs").collect(),
        users: await ctx.db.query("users").collect(),
      })),
    );
    expect(dump).not.toContain(PASSWORD);
  });
});

describe("name and room are asked once, at sign-up", () => {
  test("sign-up creates the profile and a pending resident in one step, and is audited", async () => {
    const t = await setup();
    await signIn(t, "signUp", "98765 43210", PASSWORD, { displayName: "  Asha Rao ", roomNumber: " 204 " });
    const state = await t.run(async (ctx) => ({
      profiles: await ctx.db.query("userProfiles").collect(),
      residents: await ctx.db.query("residents").collect(),
      audit: await ctx.db.query("auditLogs").collect(),
    }));
    expect(state.profiles.map((p) => [p.displayName, p.phone])).toEqual([["Asha Rao", "+919876543210"]]);
    expect(state.residents.map((r) => [r.displayName, r.roomNumber, r.status])).toEqual([["Asha Rao", "204", "pending"]]);
    expect(state.audit.map((a) => a.action)).toContain("resident.signed_up");
  });

  test("a missing or invalid name or room is refused before any account is created", async () => {
    const t = await setup();
    expect(await errorCode(signIn(t, "signUp", "9876543210", PASSWORD, { roomNumber: "204" }))).toBe("INVALID_INPUT");
    expect(await errorCode(signIn(t, "signUp", "9876543210", PASSWORD, { displayName: "Asha Rao" }))).toBe(
      "INVALID_INPUT",
    );
    expect(
      await errorCode(signIn(t, "signUp", "9876543210", PASSWORD, { displayName: "Asha Rao", roomNumber: "<b>" })),
    ).toBe("INVALID_INPUT");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
  });

  test("signing up again with a registered number never changes the saved name or room", async () => {
    const t = await setup();
    await signIn(t, "signUp", "9876543210", PASSWORD);
    await signIn(t, "signUp", "9876543210", PASSWORD, { displayName: "Someone Else", roomNumber: "999" });
    const residents = await t.run((ctx) => ctx.db.query("residents").collect());
    expect(residents.map((r) => [r.displayName, r.roomNumber])).toEqual([["Asha Rao", "204"]]);
  });

  test("signing in needs only the mobile number and password", async () => {
    const t = await setup();
    await signIn(t, "signUp", "9876543210", PASSWORD);
    expect((await signIn(t, "signIn", "9876543210", PASSWORD)).tokens?.token).toBeTruthy();
  });
});

describe("sign-in abuse protection", () => {
  test(`after ${FAILED_ATTEMPTS_LIMIT} wrong passwords, even the right password is refused for a while`, async () => {
    const t = await setup();
    await signIn(t, "signUp", "9876543210", PASSWORD);
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT; i++) {
      expect(await errorCode(signIn(t, "signIn", "9876543210", `wrong-${i}-pass`))).toBe(
        "SIGN_IN_FAILED",
      );
    }
    expect(await errorCode(signIn(t, "signIn", "9876543210", PASSWORD))).toBe(
      "TOO_MANY_ATTEMPTS",
    );
  });

  test("unregistered numbers are locked out the same way (lockout doesn't reveal registration)", async () => {
    const t = await setup();
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT; i++) {
      await signIn(t, "signIn", "9123456780", `wrong-${i}-pass`).catch(() => {});
    }
    expect(await errorCode(signIn(t, "signIn", "9123456780", PASSWORD))).toBe(
      "TOO_MANY_ATTEMPTS",
    );
  });

  test("the lockout ends when the time window passes", async () => {
    const t = await setup();
    await signIn(t, "signUp", "9876543210", PASSWORD);
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT; i++) {
      await signIn(t, "signIn", "9876543210", `wrong-${i}-pass`).catch(() => {});
    }
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("authAttemptLimits").collect()) {
        await ctx.db.patch(row._id, { windowStart: Date.now() - FAILED_ATTEMPTS_WINDOW_MS - 1 });
      }
    });
    expect((await signIn(t, "signIn", "9876543210", PASSWORD)).tokens?.token).toBeTruthy();
  });

  test("a successful sign-in clears earlier failures", async () => {
    const t = await setup();
    await signIn(t, "signUp", "9876543210", PASSWORD);
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT - 1; i++) {
      await signIn(t, "signIn", "9876543210", `wrong-${i}-pass`).catch(() => {});
    }
    await signIn(t, "signIn", "9876543210", PASSWORD);
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT - 1; i++) {
      await signIn(t, "signIn", "9876543210", `wrong-${i}-pass`).catch(() => {});
    }
    expect((await signIn(t, "signIn", "9876543210", PASSWORD)).tokens?.token).toBeTruthy();
  });

  test("new sign-ups are capped per hour across the whole app", async () => {
    const t = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("authAttemptLimits", {
        key: "signup:global",
        windowStart: Date.now(),
        count: SIGNUPS_PER_HOUR_LIMIT,
      });
    });
    expect(await errorCode(signIn(t, "signUp", "9876543210", PASSWORD))).toBe(
      "TOO_MANY_ATTEMPTS",
    );
  });

  test("the limiter functions are internal-only", async () => {
    // Internal functions carry isInternal; browsers can never call them.
    const limits = await import("../authLimits");
    for (const fn of [limits.checkAttempt, limits.recordFailure, limits.recordSignUp, limits.clearFailures]) {
      expect((fn as unknown as { isInternal?: boolean }).isInternal).toBe(true);
    }
    // And they still work when called from the backend.
    await t_internalSanity();
  });
});

async function t_internalSanity() {
  const t = await setup();
  const result = await t.mutation(internal.authLimits.checkAttempt, {
    phone: "+919876543210",
    flow: "signIn",
  });
  expect(result.allowed).toBe(true);
}
