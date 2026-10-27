import type { FunctionReturnType } from "convex/server";
import { Ban, Clock, Lock } from "lucide-react";
import type { api } from "@convex/_generated/api";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatWhen, formatWindow } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  return <StatusBadge tone="neutral" icon={Lock}>Closed</StatusBadge>;
}

/**
 * One meal's headcount as a compact row (render inside a <ul>): name, time
 * and dish on the left; Yes, No and Not answered on the right.
 */
export function MealCountRow({
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
    <li
      aria-labelledby={`meal-${meal.serviceId}`}
      className="flex flex-col gap-2.5 px-4 py-3 md:flex-row md:items-center md:gap-6 md:px-5 md:py-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2 md:justify-start md:gap-3">
          <h2 id={`meal-${meal.serviceId}`} className="font-serif text-2xl leading-none tracking-tight">
            {meal.name}
          </h2>
          <CutoffBadge meal={meal} now={now} today={today} timezone={timezone} />
        </div>
        <p className="truncate text-sm text-foreground-secondary">
          <span className="tabular">{formatWindow(meal.serviceTime, meal.endTime)}</span>
          {meal.menu ? ` · ${meal.menu}` : null}
        </p>
        {!counts.balanced ? (
          <p role="alert" className="text-sm font-medium text-danger-text">
            These numbers don&apos;t add up to {counts.eligible}. Please tell the PG Admin.
          </p>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 md:w-96">
        <Count label="Yes" value={counts.yes} emphasis />
        <Count label="No" value={counts.no} />
        <Count label="Not answered" value={counts.unanswered} warn={counts.unanswered > 0} />
      </dl>
    </li>
  );
}

function Count({ label, value, emphasis = false, warn = false }: { label: string; value: number; emphasis?: boolean; warn?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-md border px-3 py-1.5 md:py-2",
        emphasis ? "border-primary-subtle-border bg-primary-subtle" : "border-border bg-surface",
      )}
    >
      <dt className={cn("truncate text-xs", warn ? "text-warning" : "text-foreground-secondary")}>{label}</dt>
      <dd className={cn("tabular text-xl font-semibold md:text-2xl", emphasis && "text-primary-text")}>{value}</dd>
    </div>
  );
}
