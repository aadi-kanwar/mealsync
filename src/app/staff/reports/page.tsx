"use client";

import { useMutation } from "convex/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { addDays } from "@convex/lib/time";
import { usePropertyScope } from "@/components/app/property-scope";
import { RequireStaff } from "@/components/app/staff-gate";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { formatDay, todayIn } from "@/lib/format";
import { useQuery } from "@/lib/convex";

/** Matches MAX_REPORT_DAYS in convex/reports.ts. */
const MAX_DAYS = 100;

export default function ReportsPage() {
  return (
    <RequireStaff roles={[]}>
      <Reports />
    </RequireStaff>
  );
}

function Reports() {
  const { arg, timezone, current, properties } = usePropertyScope();
  const today = todayIn(timezone);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [residentId, setResidentId] = useState<Id<"residents"> | "">("");
  const people = useQuery(api.reports.residents, arg);
  const person = people?.find((p) => p.residentId === residentId);
  // Only someone from the property chosen now (the choice may have changed since).
  const forWhom = person ? { residentId: person.residentId } : {};
  const problem =
    from === "" || to === ""
      ? "Choose a start and an end date."
      : to < from
        ? "The end date must be on or after the start date."
        : addDays(from, MAX_DAYS - 1) < to
          ? `A report can cover at most ${MAX_DAYS} days.`
          : null;
  const summary = useQuery(api.reports.summary, problem === null ? { ...arg, from, to, ...forWhom } : "skip");
  const exportCsv = useMutation(api.reports.exportCsv);
  const [busy, setBusy] = useState(false);

  const presets = [
    { label: "This month", from: `${today.slice(0, 8)}01`, to: today },
    { label: "Last month", from: `${addDays(`${today.slice(0, 8)}01`, -1).slice(0, 8)}01`, to: addDays(`${today.slice(0, 8)}01`, -1) },
    { label: "Last 7 days", from: addDays(today, -6), to: today },
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description="Meal counts for the dates you choose: per meal, per day, how many said Yes, No, or didn't answer. Downloads as a spreadsheet (CSV)."
      />
      <Card className="max-w-2xl">
        <CardBody className="flex flex-col gap-4">
          <Field
            id="report-who"
            label="Report for"
            hint={person ? "Every meal this resident chose, day by day." : current ? `Totals for ${current.name}.` : "Totals for every property, PG by PG."}
          >
            {(p) => (
              <NativeSelect {...p} value={person ? residentId : ""} onChange={(e) => setResidentId(e.target.value as Id<"residents"> | "")}>
                <option value="">All residents</option>
                {(people ?? []).map((r) => (
                  <option key={r.residentId} value={r.residentId}>
                    {r.displayName} · Room {r.roomNumber}
                    {r.propertyName ? ` · ${r.propertyName}` : ""}
                    {r.movedOut ? " (moved out)" : ""}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick ranges">
            {presets.map((p) => (
              <Button
                key={p.label}
                variant={from === p.from && to === p.to ? "primary" : "secondary"}
                aria-pressed={from === p.from && to === p.to}
                onClick={() => {
                  setFrom(p.from);
                  setTo(p.to);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 items-end gap-3 sm:flex">
            <Field id="report-from" label="From" className="sm:w-44">
              {(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Field id="report-to" label="To" className="sm:w-44">
              {(p) => <Input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
            </Field>
            <Button
              className="col-span-2"
              loading={busy}
              disabled={problem !== null}
              onClick={async () => {
                setBusy(true);
                try {
                  const { filename, csv } = await exportCsv({ ...arg, from, to, ...forWhom });
                  // A byte-order mark so Excel reads the file as UTF-8.
                  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
                  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
                  document.body.append(link);
                  link.click();
                  link.remove();
                  URL.revokeObjectURL(url);
                  toast.success("Report downloaded.");
                } catch (error) {
                  toast.error(friendlyError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon icon={Download} />
              Download CSV
            </Button>
          </div>
          {problem !== null && from !== "" && to !== "" ? <Banner tone="danger">{problem}</Banner> : null}
        </CardBody>
      </Card>

      {problem !== null ? null : summary === undefined ? (
        <LoadingState rows={4} label="Loading the report" />
      ) : (
        <section aria-labelledby="summary" className="flex max-w-2xl flex-col gap-2">
          <h2 id="summary" className="font-serif text-2xl tracking-tight">
            {person ? `${person.displayName} · ` : current === null && properties.length > 1 ? "All properties · " : ""}
            {formatDay(from, "d MMM yyyy")} – {formatDay(to, "d MMM yyyy")}
          </h2>
          {summary.meals.length === 0 ? (
            <p className="text-sm text-foreground-secondary">No meals were scheduled on these dates.</p>
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Meal</TH>
                    <TH className="hidden text-right sm:table-cell">Days</TH>
                    <TH className="text-right">Yes</TH>
                    <TH className="text-right">No</TH>
                    <TH className="text-right whitespace-normal">Not answered</TH>
                    <TH className="text-right">Answered</TH>
                  </TR>
                </THead>
                <TBody>
                  {summary.meals.map((m) => {
                    const total = m.yes + m.no + m.unanswered;
                    return (
                      <TR key={m.mealType}>
                        <TD className="font-medium">{m.meal}</TD>
                        <TD className="tabular hidden text-right sm:table-cell">{m.days}</TD>
                        <TD className="tabular text-right">{m.yes}</TD>
                        <TD className="tabular text-right">{m.no}</TD>
                        <TD className="tabular text-right">{m.unanswered}</TD>
                        <TD className="tabular text-right">{total === 0 ? "–" : `${Math.round(((m.yes + m.no) / total) * 100)}%`}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </Card>
          )}
          <p className="text-sm text-foreground-secondary">
            {person
              ? "Days they were on leave or not living here, and cancelled meals, aren't in these totals; the download lists them. It has one row per meal per day, with their choice and when they last saved it."
              : "Totals add up each day's count. Residents on leave aren't counted; residents who moved out are counted for the days they lived here. The download has one row per meal per day."}
          </p>
        </section>
      )}
    </>
  );
}
