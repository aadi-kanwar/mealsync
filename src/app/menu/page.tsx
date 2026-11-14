"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { Eyebrow } from "@/components/app/brand";
import { MEAL_ICONS, dayLabel, isOpen, type Day, type Meal } from "@/components/app/meal-shared";
import { ResidentPage, type ResidentContext } from "@/components/app/resident-page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DishList } from "@/components/ui/dish-list";
import { Icon } from "@/components/ui/icon";
import { ChoiceBadge } from "@/components/ui/meal-row";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { formatClock, formatDay, formatDuration, formatWindow } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAYS_SHOWN = 7;
/** How far (px) a finger must move sideways to change the day. */
const SWIPE_DISTANCE = 50;

/** The week's menu: what's cooking next, then a menu card per day. */
export default function MenuPage() {
  return <ResidentPage>{(ctx) => <Menu {...ctx} />}</ResidentPage>;
}

/** "HH:mm" now, on the PG's clock. */
function clockIn(timezone: string, now: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** When a meal stops being served (its start, if no end time is set). */
function endOf(meal: Meal): string {
  return meal.endTime ?? meal.serviceTime;
}

function Menu(ctx: ResidentContext) {
  // The same request as This week, so whichever opens first makes the other instant.
  const data = useQuery(api.meals.myDays, { startDate: ctx.today, days: 8 });
  return (
    <>
      <PageHeader title="Menu" description="What's cooking this week. Tap a day, or swipe the card." />
      {data === undefined ? (
        <LoadingState rows={4} label="Loading the menu" />
      ) : (
        <Week days={data.days.slice(0, DAYS_SHOWN)} {...ctx} />
      )}
    </>
  );
}

type NextMeal = { day: Day; meal: Meal; state: "now" | "later" | "tomorrow"; minutes: number };

/** The meal being served now, else the next one today, else tomorrow's first. */
function findNextMeal(days: Day[], today: string, clock: string): NextMeal | null {
  const now = minutesOf(clock);
  const todayDay = days.find((d) => d.date === today);
  for (const meal of todayDay?.meals ?? []) {
    if (meal.cancelled || endOf(meal) <= clock) continue;
    const serving = meal.serviceTime <= clock;
    return {
      day: todayDay!,
      meal,
      state: serving ? "now" : "later",
      minutes: serving ? minutesOf(endOf(meal)) - now : minutesOf(meal.serviceTime) - now,
    };
  }
  const tomorrow = days[days.indexOf(todayDay!) + 1];
  const first = tomorrow?.meals.find((m) => !m.cancelled);
  if (tomorrow && first) return { day: tomorrow, meal: first, state: "tomorrow", minutes: 0 };
  return null;
}

function Week({ days, today, now, timezone }: ResidentContext & { days: Day[] }) {
  const clock = clockIn(timezone, now);
  const next = findNextMeal(days, today, clock);
  // Once today's meals are over, open on tomorrow.
  const opening = next?.state === "tomorrow" ? next.day : days[0];
  const [picked, setPicked] = useState<string | null>(null);
  // Which way the card slides in: the way the resident moved through the week.
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const selected = days.find((d) => d.date === picked) ?? opening ?? days[0];
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  if (selected === undefined) return null;
  const index = days.indexOf(selected);

  function go(to: number, focus = false) {
    const day = days[to];
    if (!day || to === index) return;
    setDirection(to > index ? "right" : "left");
    setPicked(day.date);
    if (focus) tabs.current[to]?.focus();
  }

  return (
    <>
      {next ? <NextMealCard next={next} /> : null}

      <div
        role="tablist"
        aria-label="Days"
        className="flex gap-1.5"
        onKeyDown={(event) => {
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (step !== 0 && days[index + step]) {
            event.preventDefault();
            go(index + step, true);
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
              onClick={() => go(i)}
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

      {/* Swipe sideways on the card for the next or previous day; up and down still scrolls. */}
      <div
        className="touch-pan-y"
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") swipeStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? index + 1 : index - 1);
        }}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
      >
        <MenuCard
          key={selected.date}
          day={selected}
          today={today}
          now={now}
          className={
            direction === "right" ? "animate-slide-from-right" : direction === "left" ? "animate-slide-from-left" : undefined
          }
        />
      </div>

      <Button variant="secondary" asChild className="self-start">
        <Link href={selected.date === today || selected.date === days[1]?.date ? "/home" : "/upcoming"}>
          Choose your meals
          <Icon icon={ArrowRight} />
        </Link>
      </Button>
    </>
  );
}

/** "Serving now" or "Next up": the one meal most residents open the app to check. */
function NextMealCard({ next }: { next: NextMeal }) {
  const { day, meal, state, minutes } = next;
  const eyebrow = state === "now" ? "Serving now" : state === "later" ? "Next up" : "Tomorrow";
  const when =
    state === "now"
      ? `Until ${formatClock(endOf(meal))} · ${formatDuration(minutes * 60_000)} left`
      : state === "later"
        ? `${formatWindow(meal.serviceTime, meal.endTime)} · in ${formatDuration(minutes * 60_000)}`
        : formatWindow(meal.serviceTime, meal.endTime);
  return (
    <section aria-label="Next meal">
      <Card className="flex gap-4 border-primary/30 bg-primary-subtle px-5 py-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Icon icon={MEAL_ICONS[meal.mealType]} className="size-6" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 className="font-serif text-2xl tracking-tight">{meal.name}</h2>
            <p className="tabular text-sm text-foreground-secondary">{when}</p>
          </div>
          {meal.menu ? (
            <DishList items={meal.menu} size="md" label="Next meal dishes" />
          ) : (
            <p className="text-sm text-foreground-muted italic">Menu not added yet.</p>
          )}
          {day.ineligible === null ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
              <span>Your choice:</span>
              <ChoiceBadge value={meal.selection} />
            </div>
          ) : null}
        </div>
      </Card>
    </section>
  );
}

/** One day's menu, laid out like a printed menu card. */
function MenuCard({ day, today, now, className }: { day: Day; today: string; now: number; className?: string }) {
  const label = dayLabel(day.date, today);
  const anyMenu = day.meals.some((m) => m.menu);
  return (
    <Card
      id="menu-card"
      role="tabpanel"
      aria-labelledby={`menu-tab-${day.date}`}
      className={cn("overflow-hidden", className)}
    >
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
