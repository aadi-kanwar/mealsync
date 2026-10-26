"use client";

import { useMutation } from "convex/react";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { MealRow } from "@/components/ui/meal-row";
import type { YesNo } from "@/components/ui/yes-no-toggle";
import { friendlyError } from "@/lib/errors";
import { formatTime, formatWhen, formatWindow } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DaySummary, isOpen, MEAL_ICONS, StaffChangeNote, type Day, type Meal } from "./meal-shared";

/**
 * Unsaved Yes/No choices on top of what the server has saved, and the one
 * Save for all of them. If a save fails nothing is saved: the unsaved
 * choices stay on screen and the last saved ones are unchanged.
 */
export function useMealDrafts(days: Day[], now: number) {
  const saveChoices = useMutation(api.meals.saveChoices);
  const [drafts, setDrafts] = useState<Partial<Record<Id<"mealServices">, YesNo>>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valueOf = (day: Day, meal: Meal): YesNo | null =>
    isOpen(day, meal, now) ? (drafts[meal.serviceId] ?? meal.selection) : meal.selection;
  const isUnsaved = (day: Day, meal: Meal) => {
    const draft = drafts[meal.serviceId];
    return isOpen(day, meal, now) && draft !== undefined && draft !== meal.selection;
  };
  const unsaved = days.flatMap((day) => day.meals.filter((meal) => isUnsaved(day, meal)));
  const openCount = days.reduce((n, day) => n + day.meals.filter((meal) => isOpen(day, meal, now)).length, 0);
  const lastSaved = Math.max(0, ...days.flatMap((d) => d.meals.map((m) => m.updatedAt ?? 0)));

  function choose(meal: Meal, value: YesNo) {
    setDrafts((current) => ({ ...current, [meal.serviceId]: value }));
  }
  function chooseAll(day: Day, value: YesNo) {
    setDrafts((current) => {
      const next = { ...current };
      for (const meal of day.meals) if (isOpen(day, meal, now)) next[meal.serviceId] = value;
      return next;
    });
  }

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

  return { valueOf, isUnsaved, unsaved, openCount, lastSaved, savedAt, saving, error, choose, chooseAll, save };
}

export type MealDrafts = ReturnType<typeof useMealDrafts>;

/** How many of a day's meals have an answer (saved or not yet saved). */
export function answeredCount(day: Day, drafts: MealDrafts): number {
  return day.meals.filter((meal) => !meal.cancelled && drafts.valueOf(day, meal) !== null).length;
}

/** "3 of 4 answered", with a segment per meal. */
export function AnswerProgress({ answered, total }: { answered: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn("h-1.5 flex-1 rounded-full transition-colors", i < answered ? "bg-primary" : "bg-muted")}
          />
        ))}
      </div>
      <span className="text-sm text-foreground-secondary tabular">
        {answered} of {total} answered
      </span>
    </div>
  );
}

/** One day's meals as rows with Yes/No, plus "Yes to all" / "No to all". Closed days are read-only. */
export function DayEditor({
  day,
  drafts,
  now,
  today,
  timezone,
}: {
  day: Day;
  drafts: MealDrafts;
  now: number;
  today: string;
  timezone: string;
}) {
  const open = day.meals.filter((meal) => isOpen(day, meal, now));
  if (open.length === 0) {
    return (
      <DaySummary
        day={day}
        timezone={timezone}
        today={today}
        note={
          day.meals.some((meal) => !meal.cancelled)
            ? "Choices for this day are closed. Contact the Warden to change a meal."
            : undefined
        }
      />
    );
  }
  const cutoffs = new Set(open.map((meal) => meal.cutoffAt));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => drafts.chooseAll(day, "yes")}>
          <Icon icon={Check} />
          Yes to all
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => drafts.chooseAll(day, "no")}>
          <Icon icon={X} />
          No to all
        </Button>
      </div>
      <Card>
        <ul className="divide-y divide-border" aria-label="Meals">
          {day.meals.map((meal) => {
            const mealOpen = isOpen(day, meal, now);
            const value = drafts.valueOf(day, meal);
            return (
              <MealRow
                key={meal.serviceId}
                icon={MEAL_ICONS[meal.mealType]}
                name={meal.name}
                time={formatWindow(meal.serviceTime, meal.endTime)}
                menu={meal.menu}
                value={value}
                locked={!mealOpen}
                onChange={(next) => drafts.choose(meal, next)}
              >
                {meal.cancelled ? (
                  <span className="text-foreground-secondary">Not being served.</span>
                ) : !mealOpen ? (
                  <span className="text-foreground-secondary">Closed. Contact the Warden to change it.</span>
                ) : drafts.isUnsaved(day, meal) ? (
                  <span className="font-medium text-warning">Not saved yet</span>
                ) : value === null ? (
                  <span className="font-medium text-warning">Not answered</span>
                ) : null}
                {mealOpen && cutoffs.size > 1 ? (
                  <span className="text-foreground-secondary">By {formatWhen(meal.cutoffAt, today, timezone)}</span>
                ) : null}
                <StaffChangeNote meal={meal} timezone={timezone} today={today} />
              </MealRow>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

/** Sticky at the bottom: what's unsaved or when it was saved, and the Save button. */
export function SaveBar({ drafts, today, timezone }: { drafts: MealDrafts; today: string; timezone: string }) {
  if (drafts.openCount === 0) return null;
  const n = drafts.unsaved.length;
  const status =
    n > 0
      ? n === 1
        ? "1 change not saved yet"
        : `${n} changes not saved yet`
      : drafts.savedAt !== null
        ? `Saved at ${formatTime(drafts.savedAt, timezone)}`
        : drafts.lastSaved > 0
          ? `Last saved ${formatWhen(drafts.lastSaved, today, timezone)}`
          : "Nothing saved yet";
  return (
    <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-auto flex flex-col gap-3 border-t border-border bg-surface px-4 py-3">
      {drafts.error ? (
        <Banner tone="danger" title="Not saved">
          {drafts.error} Your last saved choices haven&apos;t changed.
        </Banner>
      ) : null}
      <div className="flex items-center gap-3">
        <p
          className={cn("flex-1 text-sm", n > 0 ? "font-medium text-warning" : "text-foreground-secondary")}
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
        <Button onClick={drafts.save} loading={drafts.saving} disabled={n === 0} className="min-w-28">
          Save
        </Button>
      </div>
    </div>
  );
}
