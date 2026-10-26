import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TIMEZONE } from "@convex/lib/time";

/** "24 Oct 2026, 8:14 PM" in the PG's timezone. */
export function formatDateTime(ms: number, timezone = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(new Date(ms), timezone, "d MMM yyyy, h:mm a");
}

/** Today's date (YYYY-MM-DD) in the PG's timezone. */
export function todayIn(timezone = DEFAULT_TIMEZONE, nowMs = Date.now()): string {
  return formatInTimeZone(new Date(nowMs), timezone, "yyyy-MM-dd");
}

/** "8:14 PM" in the PG's timezone. */
export function formatTime(ms: number, timezone = DEFAULT_TIMEZONE): string {
  return formatInTimeZone(new Date(ms), timezone, "h:mm a");
}

/** A calendar date (YYYY-MM-DD) as "Sun, 25 Oct". */
export function formatDay(date: string, pattern = "EEE, d MMM"): string {
  return formatInTimeZone(new Date(`${date}T12:00:00Z`), "UTC", pattern);
}

/** A wall-clock time ("08:00") as "8:00 AM". */
export function formatClock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "9:00 PM today", "9:00 PM tomorrow" or "9:00 PM, Sat 24 Oct", relative to `today`. */
export function formatWhen(ms: number, today: string, timezone = DEFAULT_TIMEZONE): string {
  const date = formatInTimeZone(new Date(ms), timezone, "yyyy-MM-dd");
  const time = formatTime(ms, timezone);
  if (date === today) return `${time} today`;
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date === tomorrow.toISOString().slice(0, 10)) return `${time} tomorrow`;
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return `${time} yesterday`;
  return `${time}, ${formatInTimeZone(new Date(ms), timezone, "EEE d MMM")}`;
}

/** A time left as "2 h 15 min", "45 min" or "less than a minute". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A meal's time window: "7:30 – 9:30 AM", "11:30 AM – 1:00 PM", or just the start. */
export function formatWindow(start: string, end: string | null): string {
  if (end === null) return formatClock(start);
  const [from, to] = [formatClock(start), formatClock(end)];
  const [fromTime, fromSuffix] = from.split(" ");
  const toSuffix = to.split(" ")[1];
  return fromSuffix === toSuffix ? `${fromTime} – ${to}` : `${from} – ${to}`;
}
