"use client";

import { useQuery } from "convex/react";
import { Check, CheckCircle2, Minus } from "lucide-react";
import { Suspense } from "react";
import { api } from "@convex/_generated/api";
import { DatePicker, EnsureMeals, useStaffDate } from "@/components/app/staff-date";
import { RequireStaff } from "@/components/app/staff-gate";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function NonRespondersPage() {
  return (
    <RequireStaff roles={["warden"]}>
      <Suspense fallback={<LoadingState />}>
        <NonResponders />
      </Suspense>
    </RequireStaff>
  );
}

type Person = { residentId: string; displayName: string; roomNumber: string; missing: Set<string> };

function NonResponders() {
  const { date, setDate, today } = useStaffDate();
  const data = useQuery(api.dashboard.nonResponders, { date });

  // One line per person who hasn't answered at least one meal.
  const people = new Map<string, Person>();
  for (const meal of data?.meals ?? []) {
    for (const p of meal.people) {
      const person = people.get(p.residentId) ?? { ...p, missing: new Set<string>() };
      person.missing.add(meal.serviceId);
      people.set(p.residentId, person);
    }
  }
  const rows = [...people.values()].sort((a, b) =>
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }),
  );

  return (
    <>
      <EnsureMeals />
      <PageHeader title="Non-responders" description={`Who hasn't answered for ${formatDay(date, "EEEE d MMMM")}.`} />
      <DatePicker date={date} today={today} onChange={setDate} />
      {data === undefined ? (
        <LoadingState rows={4} />
      ) : data.meals.length === 0 ? (
        <EmptyState title="No meals on this day" />
      ) : rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Everyone has answered" />
      ) : (
        <section aria-labelledby="nr" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="nr" className="text-lg font-semibold tracking-tight">
              {rows.length === 1 ? "1 person" : `${rows.length} people`}
            </h2>
            <p className="text-xs text-foreground-muted">– = not answered</p>
          </div>
          <Card>
            <ul className="divide-y divide-border" aria-label="Not answered">
              {rows.map((person) => (
                <li key={person.residentId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{person.displayName}</span>
                    <span className="text-xs text-foreground-secondary">Room {person.roomNumber}</span>
                  </span>
                  <span className="flex gap-1">
                    {data.meals.map((meal) => {
                      const missing = person.missing.has(meal.serviceId);
                      return (
                        <span
                          key={meal.serviceId}
                          role="img"
                          aria-label={`${meal.name}: ${missing ? "not answered" : "answered"}`}
                          className={cn(
                            "inline-flex h-7 w-11 items-center justify-center gap-0.5 rounded-sm border text-xs font-medium",
                            missing
                              ? "border-dashed border-warning-border bg-warning-subtle text-warning"
                              : "border-border bg-subtle text-foreground-muted",
                          )}
                        >
                          {meal.name.charAt(0)}
                          <Icon icon={missing ? Minus : Check} className="size-3.5" />
                        </span>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}
