"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppFrame } from "@/components/app/app-frame";
import { AppPrompts } from "@/components/app/app-prompts";
import { Brand } from "@/components/app/brand";
import { PropertyPicker, PropertyScopeProvider } from "@/components/app/property-scope";
import { SignOutButton, useMe } from "@/components/app/session";
import { visibleNav } from "@/components/nav/nav-items";
import { BottomNav, StaffSidebar } from "@/components/nav/staff-nav";
import { LoadingState } from "@/components/ui/skeleton";
import { NotAuthorizedState } from "@/components/ui/states";

const ROLE_LABEL = { admin: "Admin", warden: "Warden" } as const;

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
    <PropertyScopeProvider>
      <AppFrame
        header={
          <header className="border-b border-border bg-surface print:hidden">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <div className="flex min-w-0 items-center gap-3">
                <Brand />
                <span className="hidden truncate border-l border-border pl-3 text-xs text-foreground-secondary lg:block">
                  {me.staff?.organizationName} · {me.profile?.displayName} ({me.staffRoles.map((r) => ROLE_LABEL[r]).join(", ")})
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <PropertyPicker />
                {/* On phones, Log out is in the bottom bar's More menu. */}
                <span className="hidden md:block">
                  <SignOutButton />
                </span>
              </div>
            </div>
          </header>
        }
        sidebar={<StaffSidebar items={items} />}
        nav={
          <BottomNav
            items={items.filter((item) => item.mobile !== false)}
            more={{
              items: items.filter((item) => item.mobile === false),
              footer: <SignOutButton variant="ghost" full />,
            }}
          />
        }
      >
        <main className="px-4 pt-6 pb-10 md:px-8 print:p-0">
          <div className="mx-auto flex max-w-5xl flex-col gap-6">{children}</div>
        </main>
      </AppFrame>
      <AppPrompts resident={false} />
    </PropertyScopeProvider>
  );
}
