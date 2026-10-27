import type { Doc } from "../_generated/dataModel";

/** Used until the Admin writes their own in Settings. */
export const DEFAULT_QUESTIONS = [
  "Hungry? Tell us what you'll be eating.",
  "What's on your plate today?",
  "Eating in today? Let the kitchen know.",
];

export const DEFAULT_WASTE_MESSAGE =
  "Every meal here is cooked fresh, and whatever isn't eaten can't be served again the next day. " +
  "It goes in the bin. When you tell us honestly which meals you'll have, we cook just enough: " +
  "no one goes hungry, and good food isn't thrown away. Thank you for helping.";

export const QUESTION_COUNT = 3;
export const MAX_QUESTION_LENGTH = 120;
export const MAX_MESSAGE_LENGTH = 600;

export function residentMessages(property: Pick<Doc<"properties">, "dailyQuestions" | "wasteMessage">) {
  const questions = (property.dailyQuestions ?? DEFAULT_QUESTIONS).filter((q) => q.trim() !== "");
  return {
    questions: questions.length > 0 ? questions : DEFAULT_QUESTIONS,
    wasteMessage: property.wasteMessage ?? DEFAULT_WASTE_MESSAGE,
  };
}

/** The question for a date: the questions take turns, one per day. */
export function questionFor(date: string, questions: readonly string[]): string {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return questions[((day % questions.length) + questions.length) % questions.length];
}
