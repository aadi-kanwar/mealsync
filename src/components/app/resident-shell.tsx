import { RESIDENT_NAV } from "@/components/nav/nav-items";
import { BottomNav } from "@/components/nav/staff-nav";
import { SignOutButton } from "./session";

/**
 * Simple frame for resident screens: app name, PG name, and logout on every
 * screen. Approved residents also get the bottom navigation (`nav`).
 */
export function ResidentShell({
  pgName,
  nav = false,
  children,
}: {
  pgName?: string | null;
  nav?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="font-semibold">MealSync</span>
            {pgName ? <span className="truncate text-xs text-foreground-secondary">{pgName}</span> : null}
          </div>
          <SignOutButton />
        </div>
      </header>
      <main
        className={
          nav
            ? "mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pt-6 pb-[calc(3.5rem+env(safe-area-inset-bottom))]"
            : "mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6"
        }
      >
        {children}
      </main>
      {nav ? <BottomNav items={RESIDENT_NAV} everywhere /> : null}
    </div>
  );
}
