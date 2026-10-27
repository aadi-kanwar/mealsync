import type { Doc } from "../_generated/dataModel";

/** Until the Admin changes them: the evening before, and early on the day. */
export const DEFAULT_REMINDER_TIMES = ["21:00", "05:00"];
export const MAX_REMINDER_TIMES = 4;

export function reminderSettings(property: Pick<Doc<"properties">, "remindersEnabled" | "reminderTimes">) {
  return {
    enabled: property.remindersEnabled ?? true,
    times: property.reminderTimes ?? DEFAULT_REMINDER_TIMES,
  };
}
