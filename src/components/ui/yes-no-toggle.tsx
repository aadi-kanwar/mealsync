"use client";

import { Check, X } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

export type YesNo = "yes" | "no";

/**
 * A two-option choice. `value` null means "not answered" (never assumed No).
 * Uses radio semantics: arrow keys move between Yes and No.
 */
export function YesNoToggle({
  value,
  onChange,
  disabled,
  label,
}: {
  value: YesNo | null;
  onChange?: (value: YesNo) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value ?? ""}
      onValueChange={(v) => onChange?.(v as YesNo)}
      disabled={disabled}
      orientation="horizontal"
      className="grid grid-cols-2 gap-2"
    >
      <Option value="yes" selected={value === "yes"} icon={Check} text="Yes" />
      <Option value="no" selected={value === "no"} icon={X} text="No" />
    </RadioGroup.Root>
  );
}

function Option({
  value,
  selected,
  icon,
  text,
}: {
  value: YesNo;
  selected: boolean;
  icon: typeof Check;
  text: string;
}) {
  return (
    <RadioGroup.Item
      value={value}
      className={cn(
        "flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        !selected && "border-border-strong bg-surface text-foreground-secondary hover:bg-subtle",
        selected && value === "yes" && "border-primary bg-primary text-primary-foreground",
        selected && value === "no" && "border-inverse bg-inverse text-white",
      )}
    >
      <Icon icon={icon} />
      {text}
    </RadioGroup.Item>
  );
}
