"use client";

import { Check, CircleDashed, Lock, X } from "lucide-react";
import { Card } from "./card";
import { StatusBadge } from "./status-badge";
import { YesNoToggle, type YesNo } from "./yes-no-toggle";

export type MealStatus = "yes" | "no" | "unanswered" | "locked";

function MealStatusBadge({ status }: { status: MealStatus }) {
  switch (status) {
    case "yes":
      return <StatusBadge tone="primary" icon={Check}>Yes</StatusBadge>;
    case "no":
      return <StatusBadge tone="neutral" icon={X}>No</StatusBadge>;
    case "unanswered":
      return <StatusBadge tone="warning" icon={CircleDashed}>Not answered</StatusBadge>;
    case "locked":
      return <StatusBadge tone="neutral" icon={Lock}>Locked</StatusBadge>;
  }
}

export function MealCard({
  name,
  time,
  value,
  locked = false,
  lockedMessage = "The cutoff has passed. Contact the Warden to change this.",
  onChange,
}: {
  name: string;
  time: string;
  value: YesNo | null;
  locked?: boolean;
  lockedMessage?: string;
  onChange?: (value: YesNo) => void;
}) {
  const status: MealStatus = locked ? "locked" : value === null ? "unanswered" : value;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h3 className="font-medium">{name}</h3>
          <span className="text-sm text-foreground-secondary">{time}</span>
        </div>
        <MealStatusBadge status={status} />
      </div>
      <YesNoToggle label={`${name}: will you eat?`} value={value} disabled={locked} onChange={onChange} />
      {locked ? <p className="text-sm text-foreground-muted">{lockedMessage}</p> : null}
    </Card>
  );
}
