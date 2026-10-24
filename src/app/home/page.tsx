"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ResidentShell } from "@/components/app/resident-shell";
import { destinationFor, useMe } from "@/components/app/session";
import { Banner } from "@/components/ui/banner";
import { LoadingState } from "@/components/ui/skeleton";

/**
 * Resident home. Phase 1 confirms the account is approved; choosing meals
 * (Phase 2) is added to this screen next.
 */
export default function ResidentHome() {
  const me = useMe();
  const router = useRouter();
  const destination = me === undefined ? null : destinationFor(me);
  useEffect(() => {
    if (destination !== null && destination !== "/home") router.replace(destination);
  }, [destination, router]);

  if (me === undefined || me === null || destination !== "/home") {
    return (
      <ResidentShell>
        <LoadingState rows={2} />
      </ResidentShell>
    );
  }

  return (
    <ResidentShell pgName={me.property?.name}>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Hello, {me.profile?.displayName}</h1>
        <p className="text-foreground-secondary">
          Room {me.resident?.roomNumber}
          {me.resident?.validFrom ? ` · since ${me.resident.validFrom}` : ""}
        </p>
      </div>
      <Banner tone="success" title="Your account is approved">
        Choosing tomorrow&apos;s meals will appear on this screen in the next update of MealSync.
      </Banner>
    </ResidentShell>
  );
}
