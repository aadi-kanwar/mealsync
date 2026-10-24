"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { CalendarX, Download, Printer, RotateCcw } from "lucide-react";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@convex/_generated/api";
import { bufferFor, type BufferRule } from "@convex/lib/headcount";
import { MealCounts, targetExplanation, type StaffMeal } from "@/components/app/meal-counts";
import { useNow } from "@/components/app/resident-page";
import { useMe } from "@/components/app/session";
import { DatePicker, EnsureMeals, useStaffDate } from "@/components/app/staff-date";
import { RequireStaff } from "@/components/app/staff-gate";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { formatDateTime, formatDay, formatWhen } from "@/lib/format";

export default function KitchenReportPage() {
  return (
    <RequireStaff roles={["warden", "kitchen"]}>
      <Suspense fallback={<LoadingState />}>
        <KitchenReport />
      </Suspense>
    </RequireStaff>
  );
}

type Ctx = { now: number; today: string; timezone: string; canCook: boolean; isAdmin: boolean };

function KitchenReport() {
  const me = useMe();
  const now = useNow();
  const { date, setDate, today, timezone } = useStaffDate();
  const day = useQuery(api.kitchen.day, { date });
  const roles = me?.staffRoles ?? [];
  const isAdmin = roles.includes("admin");
  const ctx: Ctx = { now, today, timezone, isAdmin, canCook: isAdmin || roles.includes("kitchen") };

  return (
    <>
      <EnsureMeals />
      <PageHeader
        title="Kitchen report"
        description={`${me?.property?.name ?? ""} · ${formatDay(date, "EEEE d MMMM yyyy")}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>
              <Icon icon={Printer} />
              Print
            </Button>
            <CsvButton date={date} />
          </div>
        }
      />
      <p className="hidden text-sm print:block">Printed {formatDateTime(now, timezone)}</p>
      <DatePicker date={date} today={today} onChange={setDate} />
      {day === undefined ? (
        <LoadingState rows={4} label="Loading the kitchen report" />
      ) : day.meals.length === 0 ? (
        <EmptyState icon={CalendarX} title="No meals on this day" />
      ) : (
        day.meals.map((meal) => (
          <MealCounts
            key={meal.serviceId}
            meal={meal}
            now={now}
            today={today}
            timezone={timezone}
            footer={<KitchenActions meal={meal} date={date} ctx={ctx} />}
          />
        ))
      )}
    </>
  );
}

function CsvButton({ date }: { date: string }) {
  const exportCsv = useMutation(api.kitchen.exportDayCsv);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { filename, csv } = await exportCsv({ date });
          // A byte-order mark so Excel reads the file as UTF-8.
          const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          link.click();
          URL.revokeObjectURL(url);
        } catch (error) {
          toast.error(friendlyError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? null : <Icon icon={Download} />}
      Download CSV
    </Button>
  );
}

function KitchenActions({ meal, date, ctx }: { meal: StaffMeal; date: string; ctx: Ctx }) {
  if (meal.cancelled) return null;
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <TargetSection meal={meal} ctx={ctx} />
      {meal.report !== null ? <VersionHistory meal={meal} ctx={ctx} /> : null}
      {date <= ctx.today ? <ActualsSection meal={meal} ctx={ctx} /> : null}
    </div>
  );
}

function TargetSection({ meal, ctx }: { meal: StaffMeal; ctx: Ctx }) {
  const { report } = meal;
  if (report?.status === "finalized") {
    return ctx.isAdmin ? (
      <div className="print:hidden">
        <ReopenDialog meal={meal} />
      </div>
    ) : null;
  }
  if (ctx.now < meal.cutoffAt) {
    return (
      <p className="text-sm text-foreground-secondary print:hidden">
        Residents can change their answers until {formatWhen(meal.cutoffAt, ctx.today, ctx.timezone)}. You can
        finalize the target after that.
      </p>
    );
  }
  if (!ctx.canCook) {
    return <p className="text-sm text-foreground-secondary print:hidden">The kitchen hasn&apos;t finalized this yet.</p>;
  }
  return <FinalizeForm meal={meal} />;
}

function FinalizeForm({ meal }: { meal: StaffMeal }) {
  const finalize = useMutation(api.kitchen.finalize);
  const previousRule = meal.report?.bufferRule;
  const [kind, setKind] = useState<BufferRule["kind"]>(previousRule?.kind ?? "fixed");
  const [valueText, setValueText] = useState(String(previousRule?.value ?? 0));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const value = Number(valueText);
  const limit = kind === "fixed" ? 500 : 100;
  const valid = valueText.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= limit;
  const buffer = valid ? bufferFor({ kind, value }, meal.counts.unanswered) : 0;
  const target = meal.counts.yes + buffer;
  const id = `buffer-${meal.serviceId}`;

  return (
    <div className="flex flex-col gap-3 print:hidden">
      {meal.report?.status === "needs_review" ? (
        <Banner tone="warning" title="Needs review">
          An answer changed after this was finalized. Check the counts and finalize again.
        </Banner>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field id={`${id}-kind`} label="Extra portions (buffer)" className="sm:w-72">
          {(p) => (
            <NativeSelect {...p} value={kind} onChange={(e) => setKind(e.target.value as BufferRule["kind"])}>
              <option value="fixed">A fixed number</option>
              <option value="percent_of_unanswered">A % of those who didn&apos;t answer</option>
            </NativeSelect>
          )}
        </Field>
        <Field
          id={id}
          label={kind === "fixed" ? "How many" : "Percent"}
          className="sm:w-32"
          error={valid ? undefined : `A whole number from 0 to ${limit}`}
        >
          {(p) => (
            <Input {...p} inputMode="numeric" value={valueText} onChange={(e) => setValueText(e.target.value)} />
          )}
        </Field>
      </div>
      <p className="text-sm">
        Cook for <span className="tabular text-base font-semibold">{target}</span>
        <span className="text-foreground-secondary">
          {" "}
          = Yes {meal.counts.yes} + buffer {buffer}
          {kind === "percent_of_unanswered" ? ` (${valid ? value : "?"}% of ${meal.counts.unanswered}, rounded up)` : ""}
        </span>
      </p>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setServerError(null);
        }}
      >
        <DialogTrigger asChild>
          <Button disabled={!valid || !meal.counts.balanced} className="self-start">
            Finalize target
          </Button>
        </DialogTrigger>
        <DialogContent
          title={`Finalize ${meal.name}: cook for ${target}?`}
          description={`Yes ${meal.counts.yes} + buffer ${buffer}. This is saved as a new version; only an Admin can reopen it.`}
        >
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setServerError(null);
                try {
                  await finalize({ mealServiceId: meal.serviceId, bufferRule: { kind, value }, finalTarget: target });
                  toast.success(`${meal.name} finalized: cook for ${target}.`);
                  setOpen(false);
                } catch (error) {
                  setServerError(friendlyError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReopenDialog({ meal }: { meal: StaffMeal }) {
  const reopen = useMutation(api.kitchen.reopen);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={RotateCcw} />
          Reopen
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Reopen ${meal.name}?`}
        description="The kitchen can then finalize a new target. The current version stays in the history."
      >
        {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setServerError(null);
              try {
                await reopen({ mealServiceId: meal.serviceId });
                toast.success(`${meal.name} reopened.`);
                setOpen(false);
              } catch (error) {
                setServerError(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Reopen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_TEXT = { draft: "Reopened", finalized: "Finalized", needs_review: "Needs review" } as const;

function VersionHistory({ meal, ctx }: { meal: StaffMeal; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer content-center font-medium">
        Version history (latest: v{meal.report!.version})
      </summary>
      {open ? <VersionTable meal={meal} ctx={ctx} /> : null}
    </details>
  );
}

function VersionTable({ meal, ctx }: { meal: StaffMeal; ctx: Ctx }) {
  const versions = useQuery(api.kitchen.reportVersions, { mealServiceId: meal.serviceId });
  if (versions === undefined) return <LoadingState rows={1} />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Version</TH>
          <TH>Status</TH>
          <TH className="text-right">N</TH>
          <TH className="text-right">Y</TH>
          <TH className="text-right">O</TH>
          <TH className="text-right">U</TH>
          <TH>Target</TH>
          <TH>By</TH>
          <TH>When</TH>
        </TR>
      </THead>
      <TBody>
        {versions.map((v) => (
          <TR key={v.version}>
            <TD className="tabular">v{v.version}</TD>
            <TD>{STATUS_TEXT[v.status]}</TD>
            <TD className="tabular text-right">{v.eligibleCount}</TD>
            <TD className="tabular text-right">{v.confirmedCount}</TD>
            <TD className="tabular text-right">{v.optedOutCount}</TD>
            <TD className="tabular text-right">{v.nonResponderCount}</TD>
            <TD className="whitespace-nowrap">
              <span className="tabular font-medium">{v.finalTarget}</span>
              <span className="text-foreground-secondary"> ({targetExplanation(v)})</span>
            </TD>
            <TD>{v.byName ?? "—"}</TD>
            <TD className="whitespace-nowrap">{formatWhen(v.createdAt, ctx.today, ctx.timezone)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function ActualsSection({ meal, ctx }: { meal: StaffMeal; ctx: Ctx }) {
  const a = meal.actuals;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">What actually happened</h3>
        {ctx.canCook ? <ActualsDialog meal={meal} /> : null}
      </div>
      {a === null ? (
        <p className="text-sm text-foreground-secondary">Not recorded yet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <Pair label="Prepared" value={a.preparedCount} />
            <Pair label="Served" value={a.servedCount} />
            <Pair label="Not served" value={a.preparedCount - a.servedCount} />
            <Pair label="Kept as leftover" value={a.leftoverCount} />
            <Pair label="Thrown away" value={a.discardedCount} />
            <Pair
              label="Thrown away (weighed)"
              value={a.discardedWeightGrams === null ? "Not weighed" : `${a.discardedWeightGrams} g`}
            />
          </dl>
          {a.notes ? <p className="text-sm text-foreground-secondary">Notes: {a.notes}</p> : null}
          <p className="text-xs text-foreground-muted">
            Recorded {formatWhen(a.recordedAt, ctx.today, ctx.timezone)}. All counts are portions.
          </p>
        </>
      )}
    </div>
  );
}

function Pair({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between gap-2 sm:flex-col sm:justify-start">
      <dt className="text-foreground-secondary">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}

const count = (label: string) =>
  z
    .number({ error: `Enter ${label.toLowerCase()} as a whole number.` })
    .int("Use a whole number.")
    .min(0, "Can't be negative.")
    .max(10_000, "That's too many.");

const actualsSchema = z
  .object({
    preparedCount: count("Prepared"),
    servedCount: count("Served"),
    leftoverCount: count("Leftover"),
    discardedCount: count("Thrown away"),
    discardedWeightGrams: z
      .number()
      .min(0, "Can't be negative.")
      .max(1_000_000, "That's too heavy.")
      .optional()
      .or(z.nan().transform(() => undefined)),
    notes: z.string().trim().max(500, "Use at most 500 characters."),
  })
  .superRefine((v, issue) => {
    if (v.servedCount > v.preparedCount) {
      issue.addIssue({ code: "custom", path: ["servedCount"], message: "Served can't be more than prepared." });
    } else if (v.leftoverCount + v.discardedCount > v.preparedCount - v.servedCount) {
      issue.addIssue({
        code: "custom",
        path: ["discardedCount"],
        message: "Leftover + thrown away can't be more than what wasn't served.",
      });
    }
  });

type ActualsInput = z.input<typeof actualsSchema>;
type ActualsOutput = z.output<typeof actualsSchema>;

function ActualsDialog({ meal }: { meal: StaffMeal }) {
  const record = useMutation(api.kitchen.recordActuals);
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const a = meal.actuals;
  const form = useForm<ActualsInput, unknown, ActualsOutput>({
    resolver: zodResolver(actualsSchema),
    defaultValues: {
      preparedCount: a?.preparedCount ?? NaN,
      servedCount: a?.servedCount ?? NaN,
      leftoverCount: a?.leftoverCount ?? NaN,
      discardedCount: a?.discardedCount ?? NaN,
      discardedWeightGrams: a?.discardedWeightGrams ?? NaN,
      notes: a?.notes ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await record({ mealServiceId: meal.serviceId, ...values, notes: values.notes || undefined });
      toast.success(`${meal.name}: actuals saved.`);
      setOpen(false);
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });
  const numberField = (name: Exclude<keyof ActualsInput, "notes">, label: string, hint?: string) => (
    <Field id={`${name}-${meal.serviceId}`} label={label} hint={hint} error={errors[name]?.message}>
      {(p) => <Input {...p} type="number" inputMode="numeric" min={0} {...form.register(name, { valueAsNumber: true })} />}
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="print:hidden">
          {a === null ? "Record actuals" : "Edit actuals"}
        </Button>
      </DialogTrigger>
      <DialogContent title={`${meal.name}: what actually happened`} description="Counts are portions.">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          <div className="grid grid-cols-2 gap-3">
            {numberField("preparedCount", "Prepared")}
            {numberField("servedCount", "Served")}
            {numberField("leftoverCount", "Kept as leftover")}
            {numberField("discardedCount", "Thrown away")}
          </div>
          {numberField("discardedWeightGrams", "Thrown away, weight in grams", "Only if you actually weighed it.")}
          <Field id={`notes-${meal.serviceId}`} label="Notes (optional)" error={errors.notes?.message}>
            {(p) => <Input {...p} {...form.register("notes")} />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
