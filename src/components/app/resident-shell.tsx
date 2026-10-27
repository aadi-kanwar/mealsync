import { RESIDENT_NAV } from "@/components/nav/nav-items";
import { BottomNav } from "@/components/nav/staff-nav";
import { Brand } from "./brand";
import { SignOutButton } from "./session";

/**
 * Simple frame for resident screens: app name and PG name. Approved
 * residents get the bottom navigation (`nav`) and log out from Profile;
 * everyone else gets a logout button in the header.
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
          <div className="flex min-w-0 items-center gap-3">
            <Brand />
            {pgName ? (
              <span className="truncate border-l border-border pl-3 text-xs text-foreground-secondary">{pgName}</span>
            ) : null}
          </div>
          {/* With the bottom navigation, logging out lives on the Profile screen. */}
          {nav ? null : <SignOutButton />}
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
