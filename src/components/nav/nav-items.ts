import {
  CalendarDays,
  ChefHat,
  ClipboardCheck,
  History,
  LayoutDashboard,
  Palette,
  Sun,
  UserRoundX,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { StaffRole } from "@convex/lib/validators";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles that see this item. Admin sees everything. */
  roles: readonly StaffRole[];
  /** Shown in the phone's bottom bar (default true); the sidebar shows everything. */
  mobile?: boolean;
};

export const STAFF_NAV: NavItem[] = [
  { href: "/staff", label: "Dashboard", icon: LayoutDashboard, roles: ["warden", "kitchen"] },
  { href: "/staff/non-responders", label: "Non-responders", icon: UserRoundX, roles: ["warden", "kitchen"] },
  { href: "/staff/kitchen", label: "Kitchen report", icon: ChefHat, roles: ["warden", "kitchen"] },
  { href: "/staff/signups", label: "New sign-ups", icon: ClipboardCheck, roles: ["warden"] },
  { href: "/staff/team", label: "Staff", icon: Users, roles: ["admin"] },
  { href: "/design", label: "Design system", icon: Palette, roles: ["warden", "kitchen"], mobile: false },
];

export function visibleNav(roles: readonly StaffRole[]): NavItem[] {
  if (roles.includes("admin")) return STAFF_NAV;
  return STAFF_NAV.filter((item) => item.roles.some((r) => roles.includes(r)));
}

/** Resident screens (bottom bar on every screen size). */
export const RESIDENT_NAV: NavItem[] = [
  { href: "/home", label: "Tomorrow", icon: Sun, roles: [] },
  { href: "/upcoming", label: "This week", icon: CalendarDays, roles: [] },
  { href: "/history", label: "History", icon: History, roles: [] },
];
