"use client";

import { useQuery } from "convex/react";
import { ArrowRight, CalendarX } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { api } from "@convex/_generated/api";
import { MealCounts } from "@/components/app/meal-counts";
import { useNow } from "@/components/app/resident-page";
import { useMe } from "@/components/app/session";
import { DatePicker, EnsureMeals, useStaffDate } from "@/components/app/staff-date";
import { RequireStaff } from "@/components/app/staff-gate";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
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

function Dashboard() {
  const me = useMe();
  const now = useNow();
  const { date, setDate, today, timezone } = useStaffDate();
  const day = useQuery(api.dashboard.day, { date });
  const pendingCount = useQuery(api.residents.pendingCount);
  const canApprove = me?.staffRoles.some((r) => r === "admin" || r === "warden") ?? false;
  const query = date === today ? "" : `?date=${date}`;

  return (
    <>
      <EnsureMeals />
      <PageHeader
        title="Dashboard"
        description={`Headcount for ${formatDay(date, "EEEE d MMMM yyyy")}. Updates live as residents answer.`}
        actions={
          <Button variant="secondary" asChild>
            <Link href={`/staff/non-responders${query}`}>Non-responders</Link>
          </Button>
        }
      />
      <DatePicker date={date} today={today} onChange={setDate} />

      {pendingCount === undefined ? (
        <Skeleton className="h-24" />
      ) : pendingCount > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:w-72">
            <StatCard label="Sign-ups waiting for approval" value={pendingCount} emphasis />
          </div>
          {canApprove ? (
            <Button asChild>
              <Link href="/staff/signups">
                Review new sign-ups
                <Icon icon={ArrowRight} />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {day === undefined ? (
        <LoadingState rows={4} label="Loading counts" />
      ) : day.meals.length === 0 ? (
        <EmptyState
          icon={CalendarX}
          title="No meals on this day"
          description="Meals are prepared up to 7 days ahead. Days before the PG started using MealSync have none."
        />
      ) : (
        day.meals.map((meal) => (
          <MealCounts key={meal.serviceId} meal={meal} now={now} today={today} timezone={timezone} />
        ))
      )}
    </>
  );
}
