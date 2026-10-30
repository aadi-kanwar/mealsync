"use client";

import { useMutation } from "convex/react";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/time";
import { Banner } from "@/components/ui/banner";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/errors";
import { formatDay, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePropertyScope } from "./property-scope";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The date a staff screen is showing, kept in the address (?date=...) so a
 * reload or a shared link shows the same day. Defaults to today in the PG's
 * timezone. Pages using this must sit inside a <Suspense> boundary.
 */
export function useStaffDate() {
  const { timezone } = usePropertyScope();
  const today = todayIn(timezone);
  const params = useSearchParams();
  const pathname = usePathname();
  const fromUrl = params.get("date");
  const date = fromUrl !== null && DATE_RE.test(fromUrl) ? fromUrl : today;
  const setDate = (next: string) => {
    const query = new URLSearchParams(params.toString());
    if (next === today) query.delete("date");
    else query.set("date", next);
    const search = query.toString();
    // Only the address changes: no trip to the web server (router.replace
    // would fetch the page again, which made switching dates slow).
    window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
  };
  return { date, setDate, today, timezone };
}

/** Today / Tomorrow shortcuts plus any date. */
export function DatePicker({
  date,
  today,
  onChange,
}: {
  date: string;
  today: string;
  onChange: (date: string) => void;
}) {
  const shortcuts = [
    { label: "Yesterday", value: addDays(today, -1) },
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
  ];
  return (
    <div className="flex print:hidden" role="group" aria-label="Choose a date">
      <div className="inline-flex max-w-full items-center rounded-full bg-muted p-1">
        {shortcuts.map((s) => (
          <button
            key={s.label}
            type="button"
            aria-pressed={date === s.value}
            onClick={() => onChange(s.value)}
            className={cn(
              "min-h-11 rounded-full px-3 text-sm font-medium transition-colors sm:px-4",
              date === s.value ? "bg-primary text-primary-foreground" : "text-foreground-secondary hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
        <OtherDate date={date} picked={!shortcuts.some((s) => s.value === date)} onChange={onChange} />
      </div>
    </div>
  );
}

/** A calendar button that opens the phone's date picker; shows the date when one is picked. */
function OtherDate({ date, picked, onChange }: { date: string; picked: boolean; onChange: (date: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label
      className={cn(
        "relative flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
        picked ? "bg-primary text-primary-foreground" : "text-foreground-secondary hover:text-foreground",
      )}
      onClick={(event) => {
        // Open the native picker where supported; otherwise the input receives the click.
        if (input.current && "showPicker" in input.current) {
          event.preventDefault();
          try {
            input.current.showPicker();
          } catch {
            input.current.focus();
          }
        }
      }}
    >
      <Icon icon={CalendarDays} />
      {picked ? formatDay(date, "d MMM") : <span className="sr-only">Pick a date</span>}
      <input
        ref={input}
        type="date"
        aria-label="Date"
        className="pointer-events-none absolute inset-0 opacity-0"
        value={date}
        onChange={(event) => {
          if (DATE_RE.test(event.target.value)) onChange(event.target.value);
        }}
      />
    </label>
  );
}

/**
 * Makes sure this week's meals exist before showing staff screens (normally
 * the nightly job has done it already). Shows an error with a retry if not.
 */
export function EnsureMeals() {
  const ensure = useMutation(api.meals.ensureUpcomingForStaff);
  const { arg } = usePropertyScope();
  const propertyId = arg.propertyId;
  const [error, setError] = useState<string | null>(null);
  const run = () => ensure({ propertyId }).catch((e: unknown) => setError(friendlyError(e)));
  useEffect(() => {
    void ensure({ propertyId }).catch((e: unknown) => setError(friendlyError(e)));
  }, [ensure, propertyId]);
  if (error === null) return null;
  return (
    <Banner
      tone="danger"
      title="Couldn't get this week's meals ready"
      action={
        <Button
          variant="secondary"
          onClick={() => {
            setError(null);
            void run();
          }}
        >
          Try again
        </Button>
      }
    >
      {error}
    </Banner>
  );
}
