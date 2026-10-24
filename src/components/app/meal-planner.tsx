"use client";

import { useMutation } from "convex/react";
import { Check, CircleDashed, X } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { addDays } from "@convex/lib/time";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MealCard } from "@/components/ui/meal-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { YesNo } from "@/components/ui/yes-no-toggle";
import { friendlyError } from "@/lib/errors";
import { formatClock, formatDay, formatTime, formatWhen } from "@/lib/format";

export type MyDays = FunctionReturnType<typeof api.meals.myDays>;
export type Day = MyDays["days"][number];
export type Meal = Day["meals"][number];

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

/** "Today", "Tomorrow" or "Sun, 25 Oct". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatDay(date);
}

export function StaffChangeNote({ meal, timezone, today }: { meal: Meal; timezone: string; today: string }) {
  if (meal.staffChange === null) return null;
  const { actorName, actorRole, reason, at } = meal.staffChange;
  return (
    <p>
      Changed by the {ROLE_NAMES[actorRole]} ({actorName}) at {formatWhen(at, today, timezone)}
      {reason ? `: “${reason}”` : "."}
    </p>
  );
}

/** The one cutoff all of a day's open meals share, or null if they differ (or none are open). */
export function sharedCutoff(day: Day, now: number): number | null {
  const cutoffs = new Set(day.meals.filter((meal) => isOpen(day, meal, now)).map((meal) => meal.cutoffAt));
  return cutoffs.size === 1 ? [...cutoffs][0] : null;
}

export function DayHeading({ date, today, as: Tag = "h2" }: { date: string; today: string; as?: "h2" | "h3" }) {
  const label = dayLabel(date, today);
  return (
    <Tag id={`day-${date}`} className="text-lg font-semibold tracking-tight">
      {label}
      {label !== formatDay(date) ? (
        <span className="font-normal text-foreground-secondary"> · {formatDay(date)}</span>
      ) : null}
    </Tag>
  );
}

function ChoiceBadge({ meal }: { meal: Meal }) {
  if (meal.selection === "yes") return <StatusBadge tone="primary" icon={Check}>Yes</StatusBadge>;
  if (meal.selection === "no") return <StatusBadge tone="neutral" icon={X}>No</StatusBadge>;
  return <StatusBadge tone="neutral" icon={CircleDashed}>Not answered</StatusBadge>;
}

/** A read-only list of one day's meals: past days, and days whose choices have closed. */
export function DaySummary({
  day,
  timezone,
  today,
  note,
}: {
  day: Day;
  timezone: string;
  today: string;
  note?: string;
}) {
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
            <li key={meal.serviceId} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">
                  {meal.name}
                  <span className="font-normal text-foreground-secondary"> · {formatClock(meal.serviceTime)}</span>
                </span>
                <ChoiceBadge meal={meal} />
              </div>
              <div className="text-sm text-foreground-secondary">
                {meal.cancelled ? <p>Not served.</p> : null}
                {meal.updatedAt !== null ? <p>Last changed {formatWhen(meal.updatedAt, today, timezone)}</p> : null}
                <StaffChangeNote meal={meal} timezone={timezone} today={today} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Yes/No cards for one or more days, with one Save button for every change.
 * Unsaved choices stay on screen (marked "Not saved yet") until saved; if a
 * save fails nothing is saved and the last saved choices are kept.
 */
export function MealPlanner({
  days,
  timezone,
  today,
  now,
  showDayHeadings = false,
}: {
  days: Day[];
  timezone: string;
  today: string;
  now: number;
  showDayHeadings?: boolean;
}) {
  const saveChoices = useMutation(api.meals.saveChoices);
  const [drafts, setDrafts] = useState<Partial<Record<Id<"mealServices">, YesNo>>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openMeals = days.flatMap((day) => day.meals.filter((meal) => isOpen(day, meal, now)));
  const unsaved = openMeals.filter((meal) => {
    const draft = drafts[meal.serviceId];
    return draft !== undefined && draft !== meal.selection;
  });
  const lastSaved = Math.max(0, ...days.flatMap((d) => d.meals.map((m) => m.updatedAt ?? 0)));

  async function save() {
    const choices = unsaved.map((meal) => ({ mealServiceId: meal.serviceId, selection: drafts[meal.serviceId]! }));
    setSaving(true);
    setError(null);
    try {
      const result = await saveChoices({ choices });
      setSavedAt(result.savedAt);
      // Forget the drafts that were just saved; keep any made while saving.
      setDrafts((current) => {
        const next = { ...current };
        for (const choice of choices) {
          if (next[choice.mealServiceId] === choice.selection) delete next[choice.mealServiceId];
        }
        return next;
      });
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setSaving(false);
    }
  }

  let status: string;
  if (unsaved.length > 0) {
    status = unsaved.length === 1 ? "1 change not saved yet" : `${unsaved.length} changes not saved yet`;
  } else if (savedAt !== null) {
    status = `Saved at ${formatTime(savedAt, timezone)}`;
  } else if (lastSaved > 0) {
    status = `Last saved ${formatWhen(lastSaved, today, timezone)}`;
  } else {
    status = "Nothing saved yet";
  }

  return (
    <>
      {days.map((day) => {
        const dayOpen = day.meals.some((meal) => isOpen(day, meal, now));
        const shared = sharedCutoff(day, now);
        return (
          <section key={day.date} aria-labelledby={`day-${day.date}`} className="flex flex-col gap-3">
            {showDayHeadings ? (
              <div className="flex flex-col gap-0.5">
                <DayHeading date={day.date} today={today} />
                {shared !== null ? (
                  <p className="text-sm text-foreground-secondary">Choose by {formatWhen(shared, today, timezone)}</p>
                ) : null}
              </div>
            ) : (
              <h2 id={`day-${day.date}`} className="sr-only">
                {dayLabel(day.date, today)}
              </h2>
            )}
            {!dayOpen ? (
              <DaySummary
                day={day}
                timezone={timezone}
                today={today}
                note={
                  day.meals.length > 0 && day.meals.some((meal) => !meal.cancelled)
                    ? "Choices for this day are closed. Contact the Warden to change a meal."
                    : undefined
                }
              />
            ) : (
              <>
                {day.ineligible !== null ? <Banner tone="info">{INELIGIBLE_TEXT[day.ineligible]}</Banner> : null}
                {day.meals.map((meal) => {
                  const open = isOpen(day, meal, now);
                  const draft = drafts[meal.serviceId];
                  const value = open ? (draft ?? meal.selection) : meal.selection;
                  const isUnsaved = open && draft !== undefined && draft !== meal.selection;
                  return (
                    <MealCard
                      key={meal.serviceId}
                      name={meal.name}
                      time={formatClock(meal.serviceTime)}
                      value={value}
                      locked={!open}
                      lockedMessage={
                        meal.cancelled
                          ? "This meal isn't being served."
                          : "The time to choose has passed. Contact the Warden to change this."
                      }
                      onChange={(selection) => setDrafts((current) => ({ ...current, [meal.serviceId]: selection }))}
                    >
                      {open && shared === null ? <p>Choose by {formatWhen(meal.cutoffAt, today, timezone)}</p> : null}
                      {isUnsaved ? (
                        <p className="font-medium text-warning">Not saved yet</p>
                      ) : meal.updatedAt !== null ? (
                        <p>Saved {formatWhen(meal.updatedAt, today, timezone)}</p>
                      ) : null}
                      <StaffChangeNote meal={meal} timezone={timezone} today={today} />
                    </MealCard>
                  );
                })}
              </>
            )}
          </section>
        );
      })}

      {openMeals.length > 0 ? (
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-auto flex flex-col gap-3 border-t border-border bg-surface px-4 py-3">
          {error ? (
            <Banner tone="danger" title="Not saved">
              {error} Your last saved choices haven&apos;t changed.
            </Banner>
          ) : null}
          <div className="flex items-center gap-3">
            <p className="flex-1 text-sm text-foreground-secondary" role="status" aria-live="polite">
              {status}
            </p>
            <Button onClick={save} loading={saving} disabled={unsaved.length === 0}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
