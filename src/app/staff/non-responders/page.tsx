"use client";

import { useQuery } from "convex/react";
import { CheckCircle2 } from "lucide-react";
import { Suspense } from "react";
import { api } from "@convex/_generated/api";
import { useNow } from "@/components/app/resident-page";
import { DatePicker, EnsureMeals, useStaffDate } from "@/components/app/staff-date";
import { RequireStaff } from "@/components/app/staff-gate";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { formatDay, formatWhen, formatWindow } from "@/lib/format";

export default function NonRespondersPage() {
  return (
    <RequireStaff roles={["warden"]}>
      <Suspense fallback={<LoadingState />}>
        <NonResponders />
      </Suspense>
    </RequireStaff>
  );
}

function NonResponders() {
  const now = useNow();
  const { date, setDate, today, timezone } = useStaffDate();
  const data = useQuery(api.dashboard.nonResponders, { date });
  return (
    <>
      <EnsureMeals />
      <PageHeader
        title="Non-responders"
        description={`Who hasn't answered for ${formatDay(date, "EEEE d MMMM")}. Updates live as people answer.`}
      />
      <DatePicker date={date} today={today} onChange={setDate} />
      {data === undefined ? (
        <LoadingState rows={4} />
      ) : data.meals.length === 0 ? (
        <EmptyState title="No meals on this day" />
      ) : (
        <>
          {data.meals.map((meal) => (
            <section key={meal.serviceId} aria-labelledby={`nr-${meal.serviceId}`} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`nr-${meal.serviceId}`} className="text-lg font-semibold tracking-tight">
                  {meal.name}
                  <span className="font-normal text-foreground-secondary"> · {formatWindow(meal.serviceTime, meal.endTime)}</span>
                </h2>
                <p className="text-sm text-foreground-secondary tabular">
                  {meal.people.length} of {meal.eligible} not answered ·{" "}
                  {now < meal.cutoffAt ? `closes ${formatWhen(meal.cutoffAt, today, timezone)}` : "closed"}
                </p>
              </div>
              {meal.people.length === 0 ? (
                <Card className="flex items-center gap-2 px-4 py-3 text-sm text-success">
                  <Icon icon={CheckCircle2} />
                  Everyone has answered.
                </Card>
              ) : (
                <Card>
                  <ul className="divide-y divide-border" aria-label={`${meal.name}: not answered`}>
                    {meal.people.map((person) => (
                      <li key={person.residentId} className="flex items-center justify-between gap-3 px-4 py-3">
                        <span className="font-medium">{person.displayName}</span>
                        <span className="text-sm text-foreground-secondary">Room {person.roomNumber}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          ))}
        </>
      )}
    </>
  );
}
