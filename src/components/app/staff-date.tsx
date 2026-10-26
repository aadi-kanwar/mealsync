"use client";

import { useMutation } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { addDays, DEFAULT_TIMEZONE } from "@convex/lib/time";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/errors";
import { todayIn } from "@/lib/format";
import { useMe } from "./session";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The date a staff screen is showing, kept in the address (?date=...) so a
 * reload or a shared link shows the same day. Defaults to today in the PG's
 * timezone. Pages using this must sit inside a <Suspense> boundary.
 */
export function useStaffDate() {
  const me = useMe();
  const timezone = me?.property?.timezone ?? DEFAULT_TIMEZONE;
  const today = todayIn(timezone);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = params.get("date");
  const date = fromUrl !== null && DATE_RE.test(fromUrl) ? fromUrl : today;
  const setDate = (next: string) => {
    const query = new URLSearchParams(params.toString());
    if (next === today) query.delete("date");
    else query.set("date", next);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
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
    <div className="flex flex-wrap items-end gap-2 print:hidden" role="group" aria-label="Choose a date">
      {shortcuts.map((s) => (
        <Button
          key={s.label}
          variant={date === s.value ? "primary" : "secondary"}
          aria-pressed={date === s.value}
          onClick={() => onChange(s.value)}
        >
          {s.label}
        </Button>
      ))}
      <Input
        type="date"
        aria-label="Date"
        className="w-auto"
        value={date}
        onChange={(event) => {
          if (DATE_RE.test(event.target.value)) onChange(event.target.value);
        }}
      />
    </div>
  );
}

/**
 * Makes sure this week's meals exist before showing staff screens (normally
 * the nightly job has done it already). Shows an error with a retry if not.
 */
export function EnsureMeals() {
  const ensure = useMutation(api.meals.ensureUpcomingForStaff);
  const [error, setError] = useState<string | null>(null);
  const run = () => ensure().catch((e: unknown) => setError(friendlyError(e)));
  useEffect(() => {
    void ensure().catch((e: unknown) => setError(friendlyError(e)));
  }, [ensure]);
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
