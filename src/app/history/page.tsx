"use client";

import { useQuery } from "convex/react";
import { History as HistoryIcon } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/time";
import { DayHeading, DaySummary } from "@/components/app/meal-planner";
import { ResidentPage, type ResidentContext } from "@/components/app/resident-page";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";

const WEEK = 7;

/** Past days: what the resident chose, when, and whether staff changed it. */
export default function HistoryPage() {
  return <ResidentPage>{(ctx) => <History {...ctx} />}</ResidentPage>;
}

function History(ctx: ResidentContext) {
  const [weeks, setWeeks] = useState(1);
  return (
    <>
      <PageHeader title="History" description="Your meal choices on past days, newest first." />
      {Array.from({ length: weeks }, (_, i) => (
        <HistoryWeek
          key={i}
          {...ctx}
          first={i === 0}
          startDate={addDays(ctx.today, -WEEK * (i + 1))}
          onShowEarlier={i === weeks - 1 ? () => setWeeks(weeks + 1) : undefined}
        />
      ))}
    </>
  );
}

function HistoryWeek({
  timezone,
  today,
  startDate,
  first,
  onShowEarlier,
}: ResidentContext & { startDate: string; first: boolean; onShowEarlier?: () => void }) {
  const data = useQuery(api.meals.myDays, { startDate, days: WEEK });
  if (data === undefined) return <LoadingState rows={3} label="Loading earlier days" />;
  const days = [...data.days].reverse(); // newest first
  // Days before the stay started are only shown if something was recorded on them.
  const shown = days.filter((day) => day.ineligible !== "before_start" || day.meals.some((m) => m.selection));
  const reachedStart = days.at(-1)?.ineligible === "before_start";
  return (
    <>
      {first && shown.length === 0 && reachedStart ? (
        <EmptyState
          icon={HistoryIcon}
          title="No past days yet"
          description="Your choices will appear here the day after each meal."
        />
      ) : null}
      {shown.map((day) => (
        <section key={day.date} aria-labelledby={`day-${day.date}`} className="flex flex-col gap-2">
          <DayHeading date={day.date} today={today} />
          <DaySummary day={day} timezone={timezone} today={today} />
        </section>
      ))}
      {onShowEarlier && !reachedStart ? (
        <Button variant="secondary" onClick={onShowEarlier}>
          Show earlier days
        </Button>
      ) : null}
    </>
  );
}
