"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { Eyebrow } from "@/components/app/brand";
import { MEAL_ICONS, dayLabel, isOpen, type Day } from "@/components/app/meal-shared";
import { ResidentPage, type ResidentContext } from "@/components/app/resident-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DishList } from "@/components/ui/dish-list";
import { Icon } from "@/components/ui/icon";
import { ChoiceBadge } from "@/components/ui/meal-row";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { formatDay, formatWindow } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAYS_SHOWN = 7;

/** The week's menu as a menu card: pick a day, see each meal's dishes. */
export default function MenuPage() {
  return <ResidentPage>{(ctx) => <Menu {...ctx} />}</ResidentPage>;
}

/** "HH:mm" now, on the PG's clock. */
function clockIn(timezone: string, now: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

function Menu(ctx: ResidentContext) {
  // The same request as This week, so whichever opens first makes the other instant.
  const data = useQuery(api.meals.myDays, { startDate: ctx.today, days: 8 });
  return (
    <>
      <PageHeader title="Menu" description="What's cooking this week. Choose your meals on Tomorrow or This week." />
      {data === undefined ? (
        <LoadingState rows={4} label="Loading the menu" />
      ) : (
        <Week days={data.days.slice(0, DAYS_SHOWN)} {...ctx} />
      )}
    </>
  );
}

function Week({ days, today, now, timezone }: ResidentContext & { days: Day[] }) {
  // Once today's last meal is over, open on tomorrow.
  const todayDay = days.find((d) => d.date === today);
  const lastEnd = todayDay?.meals.filter((m) => !m.cancelled).map((m) => m.endTime ?? m.serviceTime).sort().at(-1);
  const todayOver = lastEnd !== undefined && clockIn(timezone, now) >= lastEnd;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = days.find((d) => d.date === picked) ?? (todayOver ? days[1] : days[0]) ?? days[0];
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  if (selected === undefined) return null;

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
        {days.map((day, i) => {
          const isSelected = day === selected;
          return (
            <button
              key={day.date}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`menu-tab-${day.date}`}
              aria-selected={isSelected}
              aria-controls="menu-card"
              aria-label={formatDay(day.date, "EEEE d MMMM")}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setPicked(day.date)}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-md border py-2 transition-colors",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-foreground hover:bg-subtle",
              )}
            >
              <span className="text-xs font-medium">{formatDay(day.date, "EEE")}</span>
              <span className="tabular text-lg leading-6 font-semibold">{formatDay(day.date, "d")}</span>
            </button>
          );
        })}
      </div>

      <MenuCard day={selected} today={today} now={now} />

      <Button variant="secondary" asChild className="self-start">
        <Link href={selected.date === today || selected.date === days[1]?.date ? "/home" : "/upcoming"}>
          Choose your meals
          <Icon icon={ArrowRight} />
        </Link>
      </Button>
    </>
  );
}

/** One day's menu, laid out like a printed menu card. */
function MenuCard({ day, today, now }: { day: Day; today: string; now: number }) {
  const label = dayLabel(day.date, today);
  const anyMenu = day.meals.some((m) => m.menu);
  return (
    <Card id="menu-card" role="tabpanel" aria-labelledby={`menu-tab-${day.date}`} className="overflow-hidden">
      <div className="flex flex-col gap-1 border-b border-border bg-subtle px-5 py-4">
        <Eyebrow>{label === formatDay(day.date) ? formatDay(day.date, "EEEE") : label}</Eyebrow>
        <h2 className="font-serif text-2xl tracking-tight">{formatDay(day.date, "EEEE d MMMM")}</h2>
      </div>
      {day.meals.length === 0 ? (
        <p className="px-5 py-4 text-sm text-foreground-secondary">No meals are served on this day.</p>
      ) : (
        <ul className="divide-y divide-border" aria-label={`Menu for ${formatDay(day.date, "EEEE d MMMM")}`}>
          {day.meals.map((meal) => (
            <li key={meal.serviceId} className={cn("flex gap-4 px-5 py-4", meal.cancelled && "opacity-60")}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
                <Icon icon={MEAL_ICONS[meal.mealType]} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 className="font-serif text-xl tracking-tight">{meal.name}</h3>
                  <span className="tabular text-sm text-foreground-secondary">
                    {formatWindow(meal.serviceTime, meal.endTime)}
                  </span>
                </div>
                {meal.cancelled ? (
                  <p className="text-sm text-foreground-secondary">Not served this day.</p>
                ) : meal.menu ? (
                  <DishList items={meal.menu} size="md" label={`${meal.name} dishes`} />
                ) : (
                  <p className="text-sm text-foreground-muted italic">Menu not added yet.</p>
                )}
                {!meal.cancelled && day.ineligible === null ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
                    <span>Your choice:</span>
                    <ChoiceBadge value={meal.selection} />
                    {meal.selection === null && isOpen(day, meal, now) ? <span>still open</span> : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {day.meals.length > 0 && !anyMenu ? (
        <p className="border-t border-border px-5 py-3 text-sm text-foreground-secondary">
          The PG hasn&apos;t added this day&apos;s menu yet.
        </p>
      ) : null}
    </Card>
  );
}
