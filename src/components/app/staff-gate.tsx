"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { StaffRole } from "@convex/lib/validators";
import { NotAuthorizedState } from "@/components/ui/states";
import { LoadingState } from "@/components/ui/skeleton";
import { useMe } from "./session";

/**
 * Hides a staff page from people without the right role. This is only for a
 * friendly screen: the backend refuses the data either way.
 */
export function RequireStaff({
  roles,
  children,
}: {
  /** Admin is always allowed. */
  roles: readonly StaffRole[];
  children: React.ReactNode;
}) {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me === null) router.replace("/signin");
  }, [me, router]);
  if (me === undefined || me === null) return <LoadingState />;
  const allowed = me.staffRoles.includes("admin") || me.staffRoles.some((r) => roles.includes(r));
  if (!allowed) return <NotAuthorizedState />;
  return <>{children}</>;
}
