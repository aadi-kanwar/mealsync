import { formatInTimeZone } from "date-fns-tz";

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
