import { ClipboardCheck, LayoutDashboard, Palette, Users, type LucideIcon } from "lucide-react";
import type { StaffRole } from "@convex/lib/validators";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles that see this item. Admin sees everything. */
  roles: readonly StaffRole[];
};

export const STAFF_NAV: NavItem[] = [
  { href: "/staff", label: "Overview", icon: LayoutDashboard, roles: ["warden", "kitchen"] },
  { href: "/staff/signups", label: "New sign-ups", icon: ClipboardCheck, roles: ["warden"] },
  { href: "/staff/team", label: "Staff", icon: Users, roles: ["admin"] },
  { href: "/design", label: "Design system", icon: Palette, roles: ["warden", "kitchen"] },
];

export function visibleNav(roles: readonly StaffRole[]): NavItem[] {
  if (roles.includes("admin")) return STAFF_NAV;
  return STAFF_NAV.filter((item) => item.roles.some((r) => roles.includes(r)));
}
