"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { MealPlanner } from "@/components/app/meal-planner";
import { ResidentPage, type ResidentContext } from "@/components/app/resident-page";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";

/** Today and the next 7 days: set choices ahead of time. */
export default function UpcomingPage() {
  return <ResidentPage>{(ctx) => <ThisWeek {...ctx} />}</ResidentPage>;
}

function ThisWeek({ timezone, now, today }: ResidentContext) {
  const data = useQuery(api.meals.myDays, { startDate: today, days: 8 });
  return (
    <>
      <PageHeader
        title="This week"
        description="Choose meals for the next few days. Change them any time before each cutoff."
      />
      {data === undefined ? (
        <LoadingState rows={6} label="Loading this week's meals" />
      ) : (
        <MealPlanner days={data.days} timezone={timezone} today={today} now={now} showDayHeadings />
      )}
    </>
  );
}
