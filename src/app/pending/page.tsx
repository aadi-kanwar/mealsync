"use client";

import { Clock, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ResidentShell } from "@/components/app/resident-shell";
import { destinationFor, useMe } from "@/components/app/session";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";

/** Shown to anyone who can sign in but can't choose meals yet. */
export default function PendingPage() {
  const me = useMe();
  const router = useRouter();
  const destination = me === undefined ? null : destinationFor(me);

  // This screen updates live: once the Warden approves, the person moves on.
  useEffect(() => {
    if (destination !== null && destination !== "/pending") router.replace(destination);
  }, [destination, router]);

  if (me === undefined || me === null || destination !== "/pending") {
    return (
      <ResidentShell>
        <LoadingState rows={1} />
      </ResidentShell>
    );
  }

  const status = me.profile?.status !== "active" ? "disabled" : (me.resident?.status ?? "none");
  const content = {
    pending: {
      icon: Clock,
      title: "Waiting for approval",
      body: (
        <>
          Thanks, {me.profile?.displayName}. The Warden will check your details
          {me.resident?.roomNumber ? ` (room ${me.resident.roomNumber})` : ""} shortly. You can choose meals
          as soon as you&apos;re approved. This page updates by itself.
        </>
      ),
    },
    rejected: {
      icon: UserX,
      title: "Your sign-up wasn't approved",
      body: <>If you think this is a mistake, please speak to the Warden or the PG office.</>,
    },
    inactive: {
      icon: UserX,
      title: "Your stay has ended",
      body: <>Your account is no longer active for meals. Contact the PG office if this is wrong.</>,
    },
    disabled: {
      icon: UserX,
      title: "This account is switched off",
      body: <>Please contact the PG office.</>,
    },
    none: {
      icon: UserX,
      title: "No resident record",
      body: <>Please contact the PG office.</>,
    },
    active: { icon: Clock, title: "", body: null },
  }[status];

  return (
    <ResidentShell pgName={me.property?.name}>
      <Card>
        <CardBody className="flex flex-col items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-subtle text-foreground-secondary">
            <Icon icon={content.icon} />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">{content.title}</h1>
          <p className="text-foreground-secondary">{content.body}</p>
        </CardBody>
      </Card>
    </ResidentShell>
  );
}
