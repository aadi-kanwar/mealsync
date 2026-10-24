"use client";

import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { RequireStaff } from "@/components/app/staff-gate";
import { useMe } from "@/components/app/session";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";

export default function StaffOverview() {
  return (
    <RequireStaff roles={["warden", "kitchen"]}>
      <Overview />
    </RequireStaff>
  );
}

function Overview() {
  const me = useMe();
  const pendingCount = useQuery(api.residents.pendingCount);
  const canApprove = me?.staffRoles.some((r) => r === "admin" || r === "warden") ?? false;
  return (
    <>
      <PageHeader title="Overview" description={me?.property?.name} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {pendingCount === undefined ? (
          <Skeleton className="h-24" />
        ) : (
          <StatCard
            label="Sign-ups waiting for approval"
            value={pendingCount}
            emphasis={pendingCount > 0}
          />
        )}
      </div>
      {canApprove && pendingCount !== undefined && pendingCount > 0 ? (
        <div>
          <Button asChild>
            <Link href="/staff/signups">
              Review new sign-ups
              <Icon icon={ArrowRight} />
            </Link>
          </Button>
        </div>
      ) : null}
      <Banner tone="info" title="Meal counts are coming next">
        The daily dashboard with Yes / No / Not answered counts is added in a later update.
      </Banner>
    </>
  );
}
