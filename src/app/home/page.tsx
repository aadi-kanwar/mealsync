"use client";

import { useQuery } from "convex/react";
import { AlarmClock, Clock } from "lucide-react";
import { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/time";
import { AnswerProgress, answeredCount, DayEditor, SaveBar, useMealDrafts } from "@/components/app/meal-editor";
import { isOpen, type MyDays } from "@/components/app/meal-shared";
import { ResidentPage, type ResidentContext } from "@/components/app/resident-page";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { formatDay, formatDuration, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Resident home: the next day whose meals can still be chosen. Meals close
 * at 6 AM on the day, so before 6 AM that's today; after it, tomorrow.
 */
export default function ResidentHome() {
  return <ResidentPage>{(ctx) => <Tomorrow {...ctx} />}</ResidentPage>;
}

function Tomorrow(ctx: ResidentContext) {
  const data = useQuery(api.meals.myDays, { startDate: ctx.today, days: 2 });
  const todayOpen = data?.days[0].meals.some((meal) => isOpen(data.days[0], meal, ctx.now)) ?? false;
  const shown = todayOpen ? ctx.today : addDays(ctx.today, 1);
  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-foreground-secondary">
          Hello, {ctx.me.profile?.displayName} · Room {ctx.me.resident?.roomNumber}
        </p>
        <h1 className="flex flex-col">
          <span className="text-sm font-medium tracking-wide text-primary-text uppercase">
            {todayOpen ? "Today" : "Tomorrow"}
          </span>
          <span className="text-2xl font-semibold tracking-tight">{formatDay(shown, "EEEE d MMMM")}</span>
        </h1>
      </header>
      {data === undefined ? (
        <LoadingState rows={4} label="Loading meals" />
      ) : (
        <DayMeals key={shown} data={{ ...data, days: data.days.filter((d) => d.date === shown) }} {...ctx} />
      )}
    </>
  );
}

function DayMeals({ data, now, today, timezone }: ResidentContext & { data: MyDays }) {
  const day = data.days[0];
  const drafts = useMealDrafts(data.days, now);
  if (day.meals.length === 0) {
    return <EmptyState title="No meals are scheduled for this day" description="Check This week for other days." />;
  }

  const open = day.meals.filter((meal) => isOpen(day, meal, now));
  const cutoff = open.length > 0 ? Math.min(...open.map((meal) => meal.cutoffAt)) : null;
  const total = day.meals.filter((meal) => !meal.cancelled).length;
  const answered = answeredCount(day, drafts);
  const urgent =
    cutoff !== null && answered < total && cutoff - now <= data.property.bannerMinutesBeforeCutoff * 60_000;

  return (
    <>
      {cutoff !== null ? (
        <Card
          role={urgent ? "alert" : undefined}
          className={cn("flex flex-col gap-3 p-4", urgent && "border-warning-border bg-warning-subtle")}
        >
          <div className="flex items-center gap-3">
            <Icon icon={urgent ? AlarmClock : Clock} className={urgent ? "text-warning" : "text-foreground-secondary"} />
            <p className="flex-1 font-medium">Choose by {formatWhen(cutoff, today, timezone)}</p>
            <p className={cn("text-sm tabular", urgent ? "font-medium text-warning" : "text-foreground-secondary")}>
              {formatDuration(cutoff - now)} left
            </p>
          </div>
          <AnswerProgress answered={answered} total={total} />
          {urgent ? (
            <p className="text-sm text-warning">
              The cutoff is close. Meals you don&apos;t answer aren&apos;t counted as No — please choose.
            </p>
          ) : null}
        </Card>
      ) : null}
      <DayEditor day={day} drafts={drafts} now={now} today={today} timezone={timezone} />
      <SaveBar drafts={drafts} today={today} timezone={timezone} />
    </>
  );
}
