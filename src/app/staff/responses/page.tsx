"use client";

import { useQuery } from "convex/react";
import { Check, Minus, X } from "lucide-react";
import { Suspense, useState } from "react";
import { api } from "@convex/_generated/api";
import { matchesSearch, sortPeople, SortSelect, type SortKey } from "@/components/app/resident-sort";
import { DatePicker, EnsureMeals, useStaffDate } from "@/components/app/staff-date";
import { RequireStaff } from "@/components/app/staff-gate";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { formatDay, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ResponsesPage() {
  return (
    <RequireStaff roles={["warden"]}>
      <Suspense fallback={<LoadingState />}>
        <Responses />
      </Suspense>
    </RequireStaff>
  );
}

const CHOICE_TEXT = { yes: "Yes", no: "No", none: "not answered" } as const;

/** Every counted resident's choices for a day, and when they last saved. */
function Responses() {
  const { date, setDate, today, timezone } = useStaffDate();
  const data = useQuery(api.dashboard.responses, { date });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("room-asc");
  const complete = data?.residents.filter((r) => r.selections.every((s) => s !== null)).length ?? 0;
  const shown = sortPeople((data?.residents ?? []).filter((r) => matchesSearch(r, search)), sort);

  return (
    <>
      <EnsureMeals />
      <PageHeader title="Responses" description={`What each resident chose for ${formatDay(date, "EEEE d MMMM")}. Updates live.`} />
      <DatePicker date={date} today={today} onChange={setDate} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchInput label="Search by name or room" placeholder="Name or room" value={search} onChange={(e) => setSearch(e.target.value)} />
        <SortSelect value={sort} onChange={setSort} />
      </div>
      {data === undefined ? (
        <LoadingState rows={4} />
      ) : data.meals.length === 0 ? (
        <EmptyState title="No meals on this day" />
      ) : data.residents.length === 0 ? (
        <EmptyState title="No residents are counted on this day" />
      ) : (
        <section aria-labelledby="responses" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="responses" className="text-lg font-semibold tracking-tight">
              {data.residents.length} residents
              <span className="text-sm font-normal text-foreground-secondary">
                {" "}
                · {complete} answered every meal{search.trim() ? ` · showing ${shown.length}` : ""}
              </span>
            </h2>
            <p className="text-xs text-foreground-muted">✓ Yes · ✕ No · – not answered</p>
          </div>
          <Card>
            {shown.length === 0 ? (
              <p className="px-4 py-3 text-sm text-foreground-secondary">No one matches that search.</p>
            ) : null}
            <ul className="divide-y divide-border" aria-label="Residents' responses">
              {shown.map((resident) => (
                <li key={resident.residentId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{resident.displayName}</span>
                    <span className="text-xs text-foreground-secondary">Room {resident.roomNumber}</span>
                    <span className="text-xs text-foreground-muted">
                      {resident.lastSavedAt === null
                        ? "Nothing saved"
                        : `Saved ${formatWhen(resident.lastSavedAt, today, timezone)}`}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {data.meals.map((meal, i) => {
                      const choice = resident.selections[i] ?? "none";
                      return (
                        <span
                          key={meal.serviceId}
                          role="img"
                          aria-label={`${meal.name}: ${CHOICE_TEXT[choice]}`}
                          className={cn(
                            "inline-flex h-7 w-11 items-center justify-center gap-0.5 rounded-sm border text-xs font-medium",
                            choice === "yes" && "border-primary-subtle-border bg-primary-subtle text-primary-text",
                            choice === "no" && "border-border bg-subtle text-foreground-secondary",
                            choice === "none" && "border-dashed border-warning-border bg-warning-subtle text-warning",
                          )}
                        >
                          {meal.name.charAt(0)}
                          <Icon icon={choice === "yes" ? Check : choice === "no" ? X : Minus} className="size-3.5" />
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
