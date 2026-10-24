import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TIMEZONE } from "@convex/lib/time";

/** "24 Oct 2026, 8:14 PM" in the PG's timezone. */
export function formatDateTime(ms: number, timezone = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(new Date(ms), timezone, "d MMM yyyy, h:mm a");
}

/** Today's date (YYYY-MM-DD) in the PG's timezone. */
export function todayIn(timezone = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
}
