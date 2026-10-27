"use client";

import { useQuery } from "convex/react";
import { ArrowRight, CalendarX, UserPlus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { api } from "@convex/_generated/api";
import { MealCountRow } from "@/components/app/meal-counts";
import { useNow } from "@/components/app/resident-page";
import { useMe } from "@/components/app/session";
import { DatePicker, EnsureMeals, useStaffDate } from "@/components/app/staff-date";
import { RequireStaff } from "@/components/app/staff-gate";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { formatDay } from "@/lib/format";

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
  const me = useMe();
  const now = useNow();
  const { date, setDate, today, timezone } = useStaffDate();
  const day = useQuery(api.dashboard.day, { date });
  const pendingCount = useQuery(api.residents.pendingCount);
  const isAdmin = me?.staffRoles.includes("admin") ?? false;
  const counted = day?.meals.find((m) => !m.cancelled)?.counts.eligible;

  return (
    <>
      <EnsureMeals />
      <PageHeader
        title="Dashboard"
        description={`${formatDay(date, "EEEE d MMMM")}${counted !== undefined ? ` · ${counted} residents counted` : ""} · updates live`}
      />
      {/* On phones the sidebar is hidden; the Admin's other pages are one tap away here. */}
      {isAdmin ? (
        <nav aria-label="Admin pages" className="-mt-3 flex gap-4 text-sm md:hidden">
          {[
            ["/staff/menu", "Menu"],
            ["/staff/team", "Staff"],
            ["/staff/settings", "Settings"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="font-medium text-primary-text underline-offset-4 hover:underline">
              {label}
            </Link>
          ))}
        </nav>
      ) : null}
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
        <Card>
          <ul className="divide-y divide-border" aria-label="Meals">
            {day.meals.map((meal) => (
              <MealCountRow key={meal.serviceId} meal={meal} now={now} today={today} timezone={timezone} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
