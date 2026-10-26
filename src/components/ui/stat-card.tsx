import { Card } from "./card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: number | string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("flex flex-col gap-1 p-4", emphasis && "border-primary-subtle-border bg-primary-subtle")}>
      <span className="text-sm text-foreground-secondary">{label}</span>
      <span className={cn("tabular text-2xl font-semibold", emphasis && "text-primary-text")}>{value}</span>
      {hint ? <span className="text-xs text-foreground-muted">{hint}</span> : null}
    </Card>
  );
}
