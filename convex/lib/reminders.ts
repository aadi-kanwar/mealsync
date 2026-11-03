import type { Doc } from "../_generated/dataModel";

/** Until the Admin changes them: the evening before, and early on the day. */
export const DEFAULT_REMINDER_TIMES = ["21:00", "05:00"];
export const MAX_REMINDER_TIMES = 4;

/** What the notification says until the Admin writes their own. */
export const DEFAULT_REMINDER_TITLE = "Dine: choose your meals";
export const DEFAULT_REMINDER_MESSAGE =
  "You haven't chosen all your meals for {day} yet. Please answer by {deadline}, so nothing is cooked to be thrown away.";
export const MAX_REMINDER_TITLE_LENGTH = 60;
export const MAX_REMINDER_MESSAGE_LENGTH = 200;

/** Words the Admin can put in the text, filled in when each reminder goes out. */
export const REMINDER_FILL_INS = {
  "{day}": "today or tomorrow, whichever day the reminder is about",
  "{deadline}": "the time choices close, like 6:00 AM",
} as const;

type ReminderFields = Pick<
  Doc<"properties">,
  "remindersEnabled" | "reminderTimes" | "reminderTitle" | "reminderMessage"
>;

export function reminderSettings(property: ReminderFields) {
  return {
    enabled: property.remindersEnabled ?? true,
    times: property.reminderTimes ?? DEFAULT_REMINDER_TIMES,
    title: property.reminderTitle ?? DEFAULT_REMINDER_TITLE,
    message: property.reminderMessage ?? DEFAULT_REMINDER_MESSAGE,
  };
}

/** A problem with a title or message the Admin wrote, or null if it's fine. */
export function reminderTextProblem(title: string, message: string): string | null {
  if (title.length < 2 || title.length > MAX_REMINDER_TITLE_LENGTH) {
    return `The title must be 2 to ${MAX_REMINDER_TITLE_LENGTH} characters.`;
  }
  if (message.length < 5 || message.length > MAX_REMINDER_MESSAGE_LENGTH) {
    return `The message must be 5 to ${MAX_REMINDER_MESSAGE_LENGTH} characters.`;
  }
  const unknown = `${title} ${message}`.match(/\{[^}]*\}/g)?.find((w) => !(w in REMINDER_FILL_INS));
  if (unknown) return `${unknown} isn't something Dine can fill in. Use {day} or {deadline}.`;
  return null;
}

/** The notification's text with {day} and {deadline} filled in. */
export function reminderText(property: ReminderFields, fill: { day: string; deadline: string }) {
  const { title, message } = reminderSettings(property);
  const put = (text: string) => text.replaceAll("{day}", fill.day).replaceAll("{deadline}", fill.deadline);
  return { title: put(title), body: put(message) };
}
