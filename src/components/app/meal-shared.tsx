import type { FunctionReturnType } from "convex/server";
import { Coffee, Cookie, Moon, Utensils, type LucideIcon } from "lucide-react";
import type { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/time";
import type { MealType } from "@convex/lib/validators";
import { Card } from "@/components/ui/card";
import { MealRow } from "@/components/ui/meal-row";
import { formatDay, formatWhen, formatWindow } from "@/lib/format";

export type MyDays = FunctionReturnType<typeof api.meals.myDays>;
export type Day = MyDays["days"][number];
export type Meal = Day["meals"][number];

export const MEAL_ICONS: Record<MealType, LucideIcon> = {
  breakfast: Coffee,
  lunch: Utensils,
  snacks: Cookie,
  dinner: Moon,
};

export const INELIGIBLE_TEXT: Record<NonNullable<Day["ineligible"]>, string> = {
  not_active: "Your account isn't active for meals.",
  before_start: "This is before your stay starts, so you aren't counted.",
  after_end: "This is after your stay ends, so you aren't counted.",
  on_leave: "You're on approved leave, so you aren't counted.",
};

const ROLE_NAMES = { admin: "Admin", warden: "Warden", resident: "you" } as const;

/** Whether a meal can still be changed, judged by the phone's clock (the server checks again). */
export function isOpen(day: Day, meal: Meal, now: number): boolean {
  return day.ineligible === null && !meal.cancelled && now < meal.cutoffAt;
}

/** "Today", "Tomorrow", "Yesterday" or "Sun, 25 Oct". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatDay(date);
}

export function DayHeading({ date, today }: { date: string; today: string }) {
  const label = dayLabel(date, today);
  return (
    <h2 id={`day-${date}`} className="text-lg font-semibold tracking-tight">
      {label}
      {label !== formatDay(date) ? (
        <span className="font-normal text-foreground-secondary"> · {formatDay(date)}</span>
      ) : null}
    </h2>
  );
}

export function StaffChangeNote({ meal, timezone, today }: { meal: Meal; timezone: string; today: string }) {
  if (meal.staffChange === null) return null;
  const { actorName, actorRole, reason, at } = meal.staffChange;
  return (
    <span className="text-foreground-secondary">
      Changed by the {ROLE_NAMES[actorRole]} ({actorName}) at {formatWhen(at, today, timezone)}
      {reason ? `: “${reason}”` : "."}
    </span>
  );
}

/** A read-only list of one day's meals: past days, and days whose choices have closed. */
export function DaySummary({ day, timezone, today, note }: { day: Day; timezone: string; today: string; note?: string }) {
  return (
    <Card>
      {day.ineligible !== null || note ? (
        <p className="border-b border-border px-4 py-3 text-sm text-foreground-secondary">
          {day.ineligible !== null ? INELIGIBLE_TEXT[day.ineligible] : note}
        </p>
      ) : null}
      {day.meals.length === 0 ? (
        <p className="px-4 py-3 text-sm text-foreground-secondary">No meals scheduled.</p>
      ) : (
        <ul className="divide-y divide-border">
          {day.meals.map((meal) => (
            <MealRow
              key={meal.serviceId}
              icon={MEAL_ICONS[meal.mealType]}
              name={meal.name}
              time={formatWindow(meal.serviceTime, meal.endTime)}
              menu={meal.menu}
              value={meal.selection}
              locked
            >
              {meal.cancelled ? <span className="text-foreground-secondary">Not served.</span> : null}
              {meal.updatedAt !== null ? (
                <span className="text-foreground-secondary">Last changed {formatWhen(meal.updatedAt, today, timezone)}</span>
              ) : null}
              <StaffChangeNote meal={meal} timezone={timezone} today={today} />
            </MealRow>
          ))}
        </ul>
      )}
    </Card>
  );
}
