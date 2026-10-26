"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { DEFAULT_TIMEZONE } from "@convex/lib/time";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/skeleton";
import { friendlyError } from "@/lib/errors";
import { todayIn } from "@/lib/format";
import { ResidentShell } from "./resident-shell";
import { destinationFor, useMe, type Me } from "./session";

export type ResidentContext = {
  me: Me;
  timezone: string;
  /** The phone's clock, ticking. Only for display: the server decides cutoffs. */
  now: number;
  /** Today's date (YYYY-MM-DD) in the PG's timezone. */
  today: string;
};

/** The current time, updated every `intervalMs`. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Frame for screens only approved residents use. Sends everyone else to
 * their own screen, and makes sure this week's meals exist (normally the
 * daily scheduled job has already created them).
 */
export function ResidentPage({ children }: { children: (ctx: ResidentContext) => React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const now = useNow();
  const destination = me === undefined ? null : destinationFor(me);
  const ready = me !== undefined && me !== null && destination === "/home";

  useEffect(() => {
    if (destination !== null && destination !== "/home") router.replace(destination);
  }, [destination, router]);

  const ensureUpcoming = useMutation(api.meals.ensureUpcoming);
  const [setupError, setSetupError] = useState<string | null>(null);
  const prepare = useCallback(
    () => ensureUpcoming().catch((error: unknown) => setSetupError(friendlyError(error))),
    [ensureUpcoming],
  );
  useEffect(() => {
    if (ready) void prepare();
  }, [ready, prepare]);

  if (!ready) {
    return (
      <ResidentShell>
        <LoadingState rows={2} />
      </ResidentShell>
    );
  }
  const timezone = me.property?.timezone ?? DEFAULT_TIMEZONE;
  return (
    <ResidentShell pgName={me.property?.name} nav>
      {setupError ? (
        <Banner
          tone="danger"
          title="Couldn't get this week's meals ready"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSetupError(null);
                void prepare();
              }}
            >
              Try again
            </Button>
          }
        >
          {setupError}
        </Banner>
      ) : null}
      {children({ me, timezone, now, today: todayIn(timezone, now) })}
    </ResidentShell>
  );
}
