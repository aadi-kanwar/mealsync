import type { FunctionReturnType } from "convex/server";
import { Ban, Clock, Lock } from "lucide-react";
import type { api } from "@convex/_generated/api";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatWhen, formatWindow } from "@/lib/format";

export type StaffDay = FunctionReturnType<typeof api.dashboard.day>;
export type StaffMeal = StaffDay["meals"][number];

export function CutoffBadge({ meal, now, today, timezone }: { meal: StaffMeal; now: number; today: string; timezone: string }) {
  if (meal.cancelled) return <StatusBadge tone="neutral" icon={Ban}>Not served</StatusBadge>;
  if (now < meal.cutoffAt) {
    return (
      <StatusBadge tone="info" icon={Clock}>
        Open until {formatWhen(meal.cutoffAt, today, timezone)}
      </StatusBadge>
    );
  }
  return <StatusBadge tone="neutral" icon={Lock}>Choices closed</StatusBadge>;
}

/** One meal's headcount: how many said Yes, said No, and haven't answered. */
export function MealCounts({
  meal,
  now,
  today,
  timezone,
}: {
  meal: StaffMeal;
  now: number;
  today: string;
  timezone: string;
}) {
  const { counts } = meal;
  return (
    <Card role="region" aria-labelledby={`meal-${meal.serviceId}`} className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={`meal-${meal.serviceId}`} className="text-lg font-semibold tracking-tight">
            {meal.name}
            <span className="font-normal text-foreground-secondary">
              {" "}
              · {formatWindow(meal.serviceTime, meal.endTime)}
            </span>
          </h2>
          {meal.menu ? <p className="text-sm text-foreground-secondary">{meal.menu}</p> : null}
        </div>
        <CutoffBadge meal={meal} now={now} today={today} timezone={timezone} />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard label="Yes" value={counts.yes} emphasis />
        <StatCard label="No" value={counts.no} />
        <StatCard label="Not answered" value={counts.unanswered} />
      </div>
      <p className="text-sm text-foreground-secondary">
        {counts.eligible === 1 ? "1 resident" : `${counts.eligible} residents`} counted for this meal.
      </p>
      {!counts.balanced ? (
        <Banner tone="danger" title="These numbers don't add up">
          Yes, No and Not answered should together make {counts.eligible}. Don&apos;t rely on them; please tell the PG
          Admin.
        </Banner>
      ) : null}
    </Card>
  );
}
