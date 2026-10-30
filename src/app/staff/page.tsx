"use client";

import { ArrowRight, CalendarX, UserPlus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/time";
import { MealCountRow, type StaffDay } from "@/components/app/meal-counts";
import { usePropertyScope } from "@/components/app/property-scope";
import { useNow } from "@/components/app/resident-page";
import { DatePicker, EnsureMeals, useStaffDate } from "@/components/app/staff-date";
import { RequireStaff } from "@/components/app/staff-gate";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function StaffDashboard() {
  return (
    <RequireStaff roles={["warden"]}>
      <Suspense fallback={<LoadingState />}>
        <Dashboard />
      </Suspense>
    </RequireStaff>
  );
}

/** The day's headcount on one screen: one compact row per meal. */
function Dashboard() {
  const now = useNow();
  const { arg, current, properties } = usePropertyScope();
  const { date, setDate, today, timezone } = useStaffDate();
  const day = useQuery(api.dashboard.day, { ...arg, date });
  const pendingCount = useQuery(api.residents.pendingCount, arg);
  const counted = day?.meals.find((m) => !m.cancelled)?.counts.eligible;
  const where = current?.name ?? (properties.length > 1 ? "All properties" : "");

  return (
    <>
      <EnsureMeals />
      <WarmDates today={today} />
      <PageHeader
        title="Dashboard"
        description={[
          where,
          formatDay(date, "EEEE d MMMM"),
          counted !== undefined ? `${counted} residents counted` : null,
          "updates live",
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <DatePicker date={date} today={today} onChange={setDate} />

      {pendingCount !== undefined && pendingCount > 0 ? (
        <Link
          href="/staff/signups"
          className="flex items-center gap-3 rounded-md border border-warning-border bg-warning-subtle px-4 py-3 text-sm font-medium text-warning"
        >
          <Icon icon={UserPlus} />
          <span className="flex-1">
            {pendingCount === 1 ? "1 sign-up is" : `${pendingCount} sign-ups are`} waiting for approval
          </span>
          <span className="flex items-center gap-1">
            Review
            <Icon icon={ArrowRight} />
          </span>
        </Link>
      ) : null}

      {day === undefined ? (
        <LoadingState rows={4} label="Loading counts" />
      ) : day.meals.length === 0 ? (
        <EmptyState
          icon={CalendarX}
          title="No meals on this day"
          description="Meals are prepared up to 7 days ahead. Days before the PG started using Dine have none."
        />
      ) : (
        <>
          <Card>
            <ul className="divide-y divide-border" aria-label="Meals">
              {day.meals.map((meal) => (
                <MealCountRow key={meal.serviceId} meal={meal} now={now} today={today} timezone={timezone} />
              ))}
            </ul>
          </Card>
          {day.properties.length > 0 ? <ByProperty day={day} /> : null}
        </>
      )}
    </>
  );
}

/**
 * Keeps yesterday's, today's and tomorrow's counts loaded in the background,
 * so the date buttons switch instantly.
 */
function WarmDates({ today }: { today: string }) {
  const { arg } = usePropertyScope();
  useQuery(api.dashboard.day, { ...arg, date: addDays(today, -1) });
  useQuery(api.dashboard.day, { ...arg, date: today });
  useQuery(api.dashboard.day, { ...arg, date: addDays(today, 1) });
  return null;
}

/** "All properties": each property's Yes / No / Not answered per meal. */
function ByProperty({ day }: { day: StaffDay }) {
  const { choose } = usePropertyScope();
  return (
    <section aria-labelledby="by-property" className="flex flex-col gap-2">
      <h2 id="by-property" className="font-serif text-2xl tracking-tight">
        By property
      </h2>
      <Card>
        <ul className="divide-y divide-border" aria-label="Properties">
          {day.properties.map((property) => (
            <li key={property.propertyId} className="flex flex-col gap-2 px-4 py-3">
              <button
                type="button"
                onClick={() => choose(property.propertyId)}
                className="self-start text-left font-medium underline-offset-4 hover:underline"
              >
                {property.name}
              </button>
              {property.meals.length === 0 ? (
                <p className="text-sm text-foreground-secondary">No meals on this day.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`${property.name} meals`}>
                  {property.meals.map((meal) => (
                    <li
                      key={meal.mealType}
                      className={cn("rounded-md border border-border px-3 py-2", meal.cancelled && "opacity-60")}
                    >
                      <p className="text-xs font-medium text-foreground-secondary">{meal.name}</p>
                      {meal.cancelled ? (
                        <p className="text-sm text-foreground-secondary">Not served</p>
                      ) : (
                        <p className="tabular text-sm">
                          <span className="text-lg font-semibold text-primary-text">{meal.counts.yes}</span> yes ·{" "}
                          {meal.counts.no} no · {meal.counts.unanswered} not answered
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
