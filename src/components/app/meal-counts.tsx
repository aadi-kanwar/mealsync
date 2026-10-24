import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Lock, RotateCcw, Ban } from "lucide-react";
import type { api } from "@convex/_generated/api";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatClock, formatWhen } from "@/lib/format";

export type StaffDay = FunctionReturnType<typeof api.kitchen.day>;
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

export function ReportBadge({ report }: { report: StaffMeal["report"] }) {
  if (report === null) return <StatusBadge tone="neutral" icon={CircleDashed}>Not finalized</StatusBadge>;
  switch (report.status) {
    case "finalized":
      return <StatusBadge tone="success" icon={CheckCircle2}>Finalized (v{report.version})</StatusBadge>;
    case "draft":
      return <StatusBadge tone="warning" icon={RotateCcw}>Reopened (v{report.version})</StatusBadge>;
    case "needs_review":
      return <StatusBadge tone="danger" icon={AlertTriangle}>Needs review (v{report.version})</StatusBadge>;
  }
}

/** "Yes 12 + buffer 3" — how a final target was reached. */
export function targetExplanation(
  report: Pick<NonNullable<StaffMeal["report"]>, "finalTarget" | "bufferApplied" | "bufferRule">,
): string {
  const rule = report.bufferRule;
  const how =
    rule === null
      ? ""
      : rule.kind === "fixed"
        ? ` (fixed +${rule.value})`
        : ` (${rule.value}% of not answered, rounded up)`;
  return `Yes ${report.finalTarget - report.bufferApplied} + buffer ${report.bufferApplied}${how}`;
}

/**
 * One meal's numbers, always shown separately: eligible (N), Yes (Y),
 * No (O) and Not answered (U), with the N = Y + O + U check.
 */
export function MealCounts({
  meal,
  now,
  today,
  timezone,
  footer,
}: {
  meal: StaffMeal;
  now: number;
  today: string;
  timezone: string;
  footer?: React.ReactNode;
}) {
  const { counts, report } = meal;
  return (
    <Card
      role="region"
      aria-labelledby={`meal-${meal.serviceId}`}
      className="flex flex-col gap-4 p-4 sm:p-5 print:break-inside-avoid"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={`meal-${meal.serviceId}`} className="text-lg font-semibold tracking-tight">
          {meal.name}
          <span className="font-normal text-foreground-secondary"> · {formatClock(meal.serviceTime)}</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <CutoffBadge meal={meal} now={now} today={today} timezone={timezone} />
          <ReportBadge report={report} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Eligible (N)" value={counts.eligible} />
        <StatCard label="Yes (Y)" value={counts.yes} emphasis />
        <StatCard label="No (O)" value={counts.no} />
        <StatCard label="Not answered (U)" value={counts.unanswered} />
      </div>
      {!counts.balanced ? (
        <Banner tone="danger" title="These counts don't add up">
          Eligible {counts.eligible} ≠ Yes {counts.yes} + No {counts.no} + Not answered {counts.unanswered}. Don&apos;t
          rely on these numbers; please tell the PG Admin.
        </Banner>
      ) : null}
      {counts.notCounted > 0 ? (
        <p className="text-sm text-foreground-secondary">
          {counts.notCounted === 1 ? "1 answer" : `${counts.notCounted} answers`} from people not counted that day (on
          leave or outside their stay) {counts.notCounted === 1 ? "is" : "are"} left out.
        </p>
      ) : null}
      <p className="text-sm">
        {report !== null && report.status !== "draft" ? (
          <>
            <span className="font-medium">Final target: </span>
            <span className="tabular text-base font-semibold">{report.finalTarget}</span>
            <span className="text-foreground-secondary"> · {targetExplanation(report)}</span>
          </>
        ) : (
          <span className="text-foreground-secondary">No final target yet.</span>
        )}
      </p>
      {footer}
    </Card>
  );
}
