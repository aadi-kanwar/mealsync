"use client";

import { useQuery } from "convex/react";
import { Check, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { AnswerProgress, answeredCount, DayEditor, SaveBar, useMealDrafts, type MealDrafts } from "@/components/app/meal-editor";
import { dayLabel, isOpen, type Day, type MyDays } from "@/components/app/meal-shared";
import { ResidentPage, type ResidentContext } from "@/components/app/resident-page";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { formatDay, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAYS_SHOWN = 7;

/** The coming week: pick a day, choose its meals, save. */
export default function UpcomingPage() {
  return <ResidentPage>{(ctx) => <ThisWeek {...ctx} />}</ResidentPage>;
}

function ThisWeek(ctx: ResidentContext) {
  const data = useQuery(api.meals.myDays, { startDate: ctx.today, days: 8 });
  return (
    <>
      <PageHeader title="This week" description="Pick a day, choose Yes or No for each meal, then save." />
      {data === undefined ? <LoadingState rows={5} label="Loading this week's meals" /> : <Week data={data} {...ctx} />}
    </>
  );
}

function Week({ data, now, today, timezone }: ResidentContext & { data: MyDays }) {
  // Today is shown only while some of its meals can still be chosen.
  const days = data.days
    .filter((day) => day.date !== today || day.meals.some((meal) => isOpen(day, meal, now)))
    .slice(0, DAYS_SHOWN);
  const drafts = useMealDrafts(days, now);
  const firstToDo = days.find((day) => day.meals.some((m) => isOpen(day, m, now) && drafts.valueOf(day, m) === null));
  const [picked, setPicked] = useState<string | null>(null);
  const selected = days.find((day) => day.date === picked) ?? firstToDo ?? days[0];
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  if (selected === undefined) return null;
  const open = selected.meals.filter((meal) => isOpen(selected, meal, now));
  const cutoffs = [...new Set(open.map((meal) => meal.cutoffAt))];
  const total = selected.meals.filter((meal) => !meal.cancelled).length;

  return (
    <>
      <div
        role="tablist"
        aria-label="Days"
        className="flex gap-1.5"
        onKeyDown={(event) => {
          const index = days.indexOf(selected);
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          const next = days[index + step];
          if (step !== 0 && next) {
            event.preventDefault();
            setPicked(next.date);
            tabs.current[index + step]?.focus();
          }
        }}
      >
        {days.map((day, i) => (
          <DayTab
            key={day.date}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            day={day}
            drafts={drafts}
            now={now}
            today={today}
            selected={day === selected}
            onSelect={() => setPicked(day.date)}
          />
        ))}
      </div>

      <section
        role="tabpanel"
        id="day-panel"
        aria-labelledby={`tab-${selected.date}`}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-2xl tracking-tight">
            {dayLabel(selected.date, today) === formatDay(selected.date)
              ? formatDay(selected.date, "EEEE d MMMM")
              : `${dayLabel(selected.date, today)} · ${formatDay(selected.date, "EEEE d MMMM")}`}
          </h2>
          {cutoffs.length === 1 ? (
            <p className="text-sm text-foreground-secondary">Choose by {formatWhen(cutoffs[0], today, timezone)}</p>
          ) : null}
        </div>
        {open.length > 0 ? <AnswerProgress answered={answeredCount(selected, drafts)} total={total} /> : null}
        <DayEditor day={selected} drafts={drafts} now={now} today={today} timezone={timezone} />
      </section>

      <SaveBar drafts={drafts} today={today} timezone={timezone} />
    </>
  );
}

function DayTab({
  ref,
  day,
  drafts,
  now,
  today,
  selected,
  onSelect,
}: {
  ref: React.Ref<HTMLButtonElement>;
  day: Day;
  drafts: MealDrafts;
  now: number;
  today: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const open = day.meals.filter((meal) => isOpen(day, meal, now));
  const unanswered = open.filter((meal) => drafts.valueOf(day, meal) === null).length;
  const unsaved = day.meals.some((meal) => drafts.isUnsaved(day, meal));
  const label = dayLabel(day.date, today);
  const status =
    open.length === 0
      ? "closed"
      : unanswered > 0
        ? `${unanswered} not answered`
        : unsaved
          ? "not saved yet"
          : "all answered";
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`tab-${day.date}`}
      aria-selected={selected}
      aria-controls="day-panel"
      aria-label={`${label === formatDay(day.date) ? formatDay(day.date, "EEEE d MMMM") : `${label}, ${formatDay(day.date, "EEEE d MMMM")}`}: ${status}`}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-md border py-2 transition-colors",
        selected
          ? "border-primary bg-primary-subtle text-primary-text"
          : "border-border bg-surface text-foreground hover:bg-subtle",
      )}
    >
      <span className="text-xs font-medium">{formatDay(day.date, "EEE")}</span>
      <span className="tabular text-lg leading-6 font-semibold">{formatDay(day.date, "d")}</span>
      <span className="flex h-5 items-center">
        {open.length === 0 ? (
          <Icon icon={Lock} className="size-3.5 text-foreground-muted" />
        ) : unanswered > 0 ? (
          <span className="tabular rounded-full border border-warning-border bg-warning-subtle px-1.5 text-xs leading-4 font-medium text-warning">
            {unanswered}
          </span>
        ) : unsaved ? (
          <span className="size-2 rounded-full bg-warning" />
        ) : (
          <Icon icon={Check} className="size-4 text-primary" />
        )}
      </span>
    </button>
  );
}
