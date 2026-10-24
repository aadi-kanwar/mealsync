"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SignOutButton, useMe } from "@/components/app/session";
import { visibleNav } from "@/components/nav/nav-items";
import { BottomNav, StaffSidebar } from "@/components/nav/staff-nav";
import { LoadingState } from "@/components/ui/skeleton";
import { NotAuthorizedState } from "@/components/ui/states";

const ROLE_LABEL = { admin: "Admin", warden: "Warden", kitchen: "Kitchen" } as const;

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me === null) router.replace("/signin");
  }, [me, router]);

  if (me === undefined || me === null) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <LoadingState />
      </div>
    );
  }
  if (me.staffRoles.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-4">
        <NotAuthorizedState description="This area is for PG staff only." />
        <div className="flex justify-center">
          <SignOutButton variant="secondary" />
        </div>
      </main>
    );
  }

  const items = visibleNav(me.staffRoles);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface print:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="font-semibold">MealSync</span>
            <span className="truncate text-xs text-foreground-secondary">
              {me.property?.name} · {me.profile?.displayName} (
              {me.staffRoles.map((r) => ROLE_LABEL[r]).join(", ")})
            </span>
          </div>
          <SignOutButton />
        </div>
      </header>
      <div className="flex flex-1">
        <StaffSidebar items={items} />
        <main className="min-w-0 flex-1 px-4 pt-6 pb-24 md:px-8 md:pb-10 print:p-0">
          <div className="mx-auto flex max-w-5xl flex-col gap-6">{children}</div>
        </main>
      </div>
      <BottomNav items={items.filter((item) => item.mobile !== false)} />
    </div>
  );
}
