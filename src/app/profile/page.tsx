"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { ResidentPage, type ResidentContext } from "@/components/app/resident-page";
import { SignOutButton } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { formatDay } from "@/lib/format";

/** The resident's own details (given once at sign-up) and password change. */
export default function ProfilePage() {
  return <ResidentPage>{(ctx) => <Profile {...ctx} />}</ResidentPage>;
}

function Profile({ me }: ResidentContext) {
  const rows: Array<[string, string]> = [
    ["Name", me.profile?.displayName ?? ""],
    ["Room", me.resident?.roomNumber ?? ""],
    ["Mobile number", me.phone ? formatPhoneForDisplay(me.phone) : "Not available"],
    ["Eating here since", me.resident?.validFrom ? formatDay(me.resident.validFrom, "d MMMM yyyy") : "—"],
  ];
  if (me.resident?.validUntil) rows.push(["Last day", formatDay(me.resident.validUntil, "d MMMM yyyy")]);
  return (
    <>
      <PageHeader title="Profile" description="To change your name or room, please ask the Warden." />
      <Card>
        <dl className="divide-y divide-border">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-foreground-secondary">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" asChild>
          <Link href="/change-password">
            <Icon icon={KeyRound} />
            Change password
          </Link>
        </Button>
        <SignOutButton variant="secondary" />
      </div>
    </>
  );
}
