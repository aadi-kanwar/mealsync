"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-items";

function isActive(pathname: string, href: string) {
  return href === "/staff" ? pathname === "/staff" : pathname.startsWith(href);
}

/** Desktop: a sidebar. Hidden below the `md` breakpoint. */
export function StaffSidebar({
  items,
  footer,
  preview = false,
}: {
  items: NavItem[];
  footer?: React.ReactNode;
  /** Always visible, for the /design page. */
  preview?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={preview ? "Staff (preview)" : "Staff"}
      className={cn(
        "w-60 shrink-0 flex-col justify-between border-r border-border bg-surface p-3 print:hidden",
        preview ? "flex" : "sticky top-14 hidden h-[calc(100dvh-3.5rem)] self-start overflow-y-auto md:flex",
      )}
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-subtle text-primary-text"
                    : "text-foreground-secondary hover:bg-subtle hover:text-foreground",
                )}
              >
                <Icon icon={item.icon} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {footer}
    </nav>
  );
}

/** Mobile: a bottom bar. Hidden from `md` up unless `everywhere` (resident screens have no sidebar). */
export function BottomNav({
  items,
  preview = false,
  everywhere = false,
}: {
  items: NavItem[];
  preview?: boolean;
  everywhere?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={preview ? "Main (preview)" : "Main"}
      className={cn(
        "border-t border-border bg-surface print:hidden",
        !preview && "fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)]",
        !preview && !everywhere && "md:hidden",
      )}
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium",
                  active ? "text-primary-text" : "text-foreground-secondary",
                )}
              >
                <Icon icon={item.icon} />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
