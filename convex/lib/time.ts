import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { CutoffRule } from "./validators";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** The property-local calendar date (YYYY-MM-DD) at `nowMs`. */
export function localDateString(nowMs: number, timezone: string): string {
  return formatInTimeZone(new Date(nowMs), timezone, "yyyy-MM-dd");
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Calendar arithmetic on YYYY-MM-DD strings (no timezone involved). */
export function addDays(date: string, days: number): string {
  const result = parseDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, for a calendar date. */
export function weekdayOf(date: string): number {
  return parseDate(date).getUTCDay();
}

/** The UTC instant of `date` at `time` ("HH:mm") on the wall clock of `timezone`. */
export function zonedDateTimeToUtc(date: string, time: string, timezone: string): number {
  return fromZonedTime(`${date}T${time}:00`, timezone).getTime();
}

/**
 * When choices for a meal on `serviceDate` close. Example: a "1 day before,
 * 21:00" rule for Tuesday breakfast in Asia/Kolkata closes Monday 21:00 IST.
 */
export function computeCutoffAt(serviceDate: string, rule: CutoffRule, timezone: string): number {
  return zonedDateTimeToUtc(addDays(serviceDate, -rule.daysBefore), rule.time, timezone);
}
