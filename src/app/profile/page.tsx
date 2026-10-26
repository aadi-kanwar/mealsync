"use client";

import { useQuery } from "convex/react";
import { Check, KeyRound, Minus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { addDays } from "@convex/lib/time";
import { dayLabel, type Day, type Meal } from "@/components/app/meal-shared";
import { ResidentPage, type ResidentContext } from "@/components/app/resident-page";
import { SignOutButton } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAYS_PER_PAGE = 14;

/** The resident's own details (given once at sign-up), password, past choices and log out. */
export default function ProfilePage() {
  return <ResidentPage>{(ctx) => <Profile {...ctx} />}</ResidentPage>;
}

function Profile(ctx: ResidentContext) {
  const { me } = ctx;
  const rows: Array<[string, string]> = [
    ["Name", me.profile?.displayName ?? ""],
    ["Room", me.resident?.roomNumber ?? ""],
    ["Mobile number", me.phone ? formatPhoneForDisplay(me.phone) : "Not available"],
  ];
  if (me.resident?.validUntil) rows.push(["Last day", formatDay(me.resident.validUntil, "d MMMM yyyy")]);
  return (
    <>
      <PageHeader title="Profile" description="To change your name or room, please ask the Warden." />
      <Card>
        <dl className="divide-y divide-border">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-foreground-secondary">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Button variant="secondary" asChild>
        <Link href="/change-password">
          <Icon icon={KeyRound} />
          Change password
        </Link>
      </Button>
      <History {...ctx} />
      <SignOutButton variant="secondary" />
    </>
  );
}

function History({ today, me }: ResidentContext) {
  const [pages, setPages] = useState(1);
  return (
    <section aria-labelledby="history" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="history" className="text-lg font-semibold tracking-tight">
          History
        </h2>
        <p className="text-xs text-foreground-muted">B L S D = Breakfast, Lunch, Snacks, Dinner</p>
      </div>
      <Card>
        <ul className="divide-y divide-border" aria-label="Past days">
          {Array.from({ length: pages }, (_, i) => (
            <HistoryPage
              key={i}
              startDate={addDays(today, -DAYS_PER_PAGE * (i + 1))}
              today={today}
              stayStart={me.resident?.validFrom ?? null}
              first={i === 0}
              onMore={i === pages - 1 ? () => setPages(pages + 1) : undefined}
            />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function HistoryPage({
  startDate,
  today,
  stayStart,
  first,
  onMore,
}: {
  startDate: string;
  today: string;
  stayStart: string | null;
  first: boolean;
  onMore?: () => void;
}) {
  const data = useQuery(api.meals.myDays, { startDate, days: DAYS_PER_PAGE });
  if (data === undefined) {
    return (
      <li className="px-4 py-3">
        <Skeleton className="h-5 w-full" />
      </li>
    );
  }
  // Newest first; nothing from before the stay started.
  const days = [...data.days].reverse().filter((day) => stayStart === null || day.date >= stayStart);
  const reachedStart = stayStart === null || startDate <= stayStart;
  return (
    <>
      {first && days.length === 0 ? (
        <li className="px-4 py-3 text-sm text-foreground-secondary">No past days yet.</li>
      ) : null}
      {days.map((day) => (
        <HistoryRow key={day.date} day={day} today={today} />
      ))}
      {onMore && !reachedStart ? (
        <li>
          <Button variant="ghost" width="full" onClick={onMore}>
            Show earlier days
          </Button>
        </li>
      ) : null}
    </>
  );
}

function HistoryRow({ day, today }: { day: Day; today: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-sm font-medium">{dayLabel(day.date, today)}</span>
      {day.ineligible === "on_leave" ? (
        <span className="text-sm text-foreground-secondary">On leave</span>
      ) : (
        <span className="flex gap-1">
          {day.meals.map((meal) => (
            <Choice key={meal.serviceId} meal={meal} />
          ))}
        </span>
      )}
    </li>
  );
}

const CHOICE_TEXT = { yes: "Yes", no: "No", none: "Not answered" } as const;

function Choice({ meal }: { meal: Meal }) {
  const choice = meal.cancelled ? null : (meal.selection ?? "none");
  const icon = choice === "yes" ? Check : choice === "no" ? X : Minus;
  return (
    <span
      role="img"
      aria-label={`${meal.name}: ${choice === null ? "not served" : CHOICE_TEXT[choice]}`}
      className={cn(
        "inline-flex h-7 w-11 items-center justify-center gap-0.5 rounded-sm border text-xs font-medium",
        choice === "yes" && "border-primary-subtle-border bg-primary-subtle text-primary-text",
        choice === "no" && "border-border bg-subtle text-foreground-secondary",
        (choice === "none" || choice === null) && "border-dashed border-border-strong text-foreground-muted",
      )}
    >
      {meal.name.charAt(0)}
      <Icon icon={icon} className="size-3.5" />
    </span>
  );
}
