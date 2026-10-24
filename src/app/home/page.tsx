"use client";

import { useQuery } from "convex/react";
import { Clock } from "lucide-react";
import { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/time";
import { isOpen, MealPlanner } from "@/components/app/meal-planner";
import { ResidentPage, type ResidentContext } from "@/components/app/resident-page";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { formatDay, formatDuration, formatWhen } from "@/lib/format";

/** Resident home: choose tomorrow's meals before the cutoff. */
export default function ResidentHome() {
  return <ResidentPage>{(ctx) => <Tomorrow {...ctx} />}</ResidentPage>;
}

function Tomorrow({ me, timezone, now, today }: ResidentContext) {
  const tomorrow = addDays(today, 1);
  const data = useQuery(api.meals.myDays, { startDate: tomorrow, days: 1 });

  const greeting = (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight">Hello, {me.profile?.displayName}</h1>
      <p className="text-foreground-secondary">
        Tomorrow&apos;s meals · {formatDay(tomorrow, "EEEE d MMMM")} · Room {me.resident?.roomNumber}
      </p>
    </div>
  );
  if (data === undefined) {
    return (
      <>
        {greeting}
        <LoadingState rows={4} label="Loading tomorrow's meals" />
      </>
    );
  }

  const day = data.days[0];
  const open = day.meals.filter((meal) => isOpen(day, meal, now));
  const nextCutoff = open.length > 0 ? Math.min(...open.map((meal) => meal.cutoffAt)) : null;
  const unanswered = open.filter((meal) => meal.selection === null);
  const cutoffNear =
    nextCutoff !== null && nextCutoff - now <= data.property.bannerMinutesBeforeCutoff * 60_000;

  return (
    <>
      {greeting}
      {day.meals.length === 0 ? (
        <EmptyState title="No meals are scheduled for tomorrow" description="Check This week for other days." />
      ) : (
        <>
          {nextCutoff !== null ? (
            <Card>
              <CardBody className="flex items-center gap-3">
                <Icon icon={Clock} className="text-foreground-secondary" />
                <div className="flex flex-col">
                  <p className="font-medium">Choose by {formatWhen(nextCutoff, today, timezone)}</p>
                  <p className="text-sm text-foreground-secondary tabular">
                    {formatDuration(nextCutoff - now)} left
                  </p>
                </div>
              </CardBody>
            </Card>
          ) : day.ineligible === null ? (
            <Banner tone="info" title="Choices for tomorrow are closed">
              To change a meal now, contact the Warden.
            </Banner>
          ) : null}
          {cutoffNear && unanswered.length > 0 ? (
            <Banner tone="warning" title={`Only ${formatDuration(nextCutoff - now)} left`}>
              You haven&apos;t answered {unanswered.map((meal) => meal.name).join(", ")} yet. Unanswered meals
              aren&apos;t counted as No — please choose.
            </Banner>
          ) : null}
          <MealPlanner days={data.days} timezone={timezone} today={today} now={now} />
        </>
      )}
    </>
  );
}
