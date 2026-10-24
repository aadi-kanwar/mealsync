import { describe, expect, test } from "vitest";
import { formatPhoneForDisplay, isoDateSchema, normalizePhone, passwordProblem } from "../lib/inputRules";
import { localDateString } from "../lib/time";

describe("phone numbers", () => {
  test("Indian numbers in any common format become E.164", () => {
    for (const input of ["9876543210", "098765 43210", "+91 98765 43210", "+91-98765-43210", " 98765-43210 "]) {
      expect(normalizePhone(input), input).toBe("+919876543210");
    }
  });
  test("other countries work with a + prefix", () => {
    expect(normalizePhone("+1 415 555 2671")).toBe("+14155552671");
  });
  test("junk is rejected", () => {
    for (const input of ["", "123", "abcdefghij", "+91 12345", "9".repeat(25)]) {
      expect(normalizePhone(input), input).toBeNull();
    }
  });
  test("display format", () => {
    expect(formatPhoneForDisplay("+919876543210")).toBe("+91 98765 43210");
  });
});

describe("passwords", () => {
  test("rules", () => {
    expect(passwordProblem("good-pass", null)).toBeNull();
    expect(passwordProblem("short", null)).toMatch(/at least 8/);
    expect(passwordProblem("x".repeat(129), null)).toMatch(/at most/);
    expect(passwordProblem("zzzzzzzzz", null)).toMatch(/repeated/);
    expect(passwordProblem("pw9876543210", "+919876543210")).toMatch(/phone number/);
  });
});

describe("dates", () => {
  test("only real YYYY-MM-DD dates pass", () => {
    expect(isoDateSchema.safeParse("2026-11-03").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(isoDateSchema.safeParse("2028-02-29").success).toBe(true);
    expect(isoDateSchema.safeParse("3/11/2026").success).toBe(false);
  });
  test("the PG's local date is used, not UTC", () => {
    // 2026-11-02 19:00 UTC is already 2026-11-03 00:30 in India.
    expect(localDateString(Date.UTC(2026, 10, 2, 19, 0), "Asia/Kolkata")).toBe("2026-11-03");
    expect(localDateString(Date.UTC(2026, 10, 2, 18, 0), "Asia/Kolkata")).toBe("2026-11-02");
  });
});
