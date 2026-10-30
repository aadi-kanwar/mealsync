"use client";

import { useMutation } from "convex/react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/time";
import { MEAL_TYPES, type MealType } from "@convex/lib/validators";
import type { Id } from "@convex/_generated/dataModel";
import { MEAL_ICONS } from "@/components/app/meal-shared";
import { RequireOneProperty } from "@/components/app/property-scope";
import { RequireStaff } from "@/components/app/staff-gate";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { downloadBlob, menuWorkbook, readMenuWorkbook } from "@/lib/menu-excel";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/convex";

type MenuData = FunctionReturnType<typeof api.menus.get>;
type Label = "A" | "B";
type Draft = Record<string, string>; // "weekday:mealType" -> dishes

const MEAL_NAMES: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner" };
// Monday first, as on a menu chart. 0 = Sunday.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const key = (weekday: number, mealType: MealType) => `${weekday}:${mealType}`;

function toDraft(entries: MenuData["menus"][number]["entries"]): Draft {
  return Object.fromEntries(entries.map((e) => [key(e.weekday, e.mealType), e.items]));
}

function toEntries(draft: Draft) {
  return WEEKDAYS.flatMap((weekday) =>
    MEAL_TYPES.map((mealType) => ({ weekday, mealType, items: (draft[key(weekday, mealType)] ?? "").trim() })),
  ).filter((e) => e.items !== "");
}

const same = (a: Draft, b: Draft) => JSON.stringify(toEntries(a)) === JSON.stringify(toEntries(b));

export default function MenuPage() {
  return (
    <RequireStaff roles={[]}>
      <Menu />
    </RequireStaff>
  );
}

function Menu() {
  return (
    <>
      <PageHeader
        title="Menu"
        description="Fill in your two weekly menus, here or in Excel. They take turns week by week (Monday to Sunday), and residents see each meal's dishes."
      />
      <RequireOneProperty what="The menu">
        {(property) => <PropertyMenu key={property.propertyId} propertyId={property.propertyId} name={property.name} />}
      </RequireOneProperty>
    </>
  );
}

function PropertyMenu({ propertyId, name }: { propertyId: Id<"properties">; name: string }) {
  const data = useQuery(api.menus.get, { propertyId });
  if (data === undefined) return <LoadingState rows={4} />;
  return (
    <>
      <Rotation data={data} propertyId={propertyId} />
      <MenuEditor data={data} propertyId={propertyId} propertyName={name} />
    </>
  );
}

function Rotation({ data, propertyId }: { data: MenuData; propertyId: Id<"properties"> }) {
  const setThisWeek = useMutation(api.menus.setThisWeek);
  const [busy, setBusy] = useState<Label | null>(null);
  const week = `${formatDay(data.thisWeekStart, "d MMM")} – ${formatDay(addDays(data.thisWeekStart, 6), "d MMM")}`;
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">This week ({week}) uses</p>
        <p className="text-sm text-foreground-secondary">
          {data.thisWeek === null
            ? "Choose one to start showing menus to residents."
            : `Next week: Menu ${data.nextWeek}. It keeps alternating by itself.`}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="This week's menu">
        {(["A", "B"] as const).map((label) => (
          <Button
            key={label}
            variant={data.thisWeek === label ? "primary" : "secondary"}
            aria-pressed={data.thisWeek === label}
            loading={busy === label}
            onClick={async () => {
              if (data.thisWeek === label) return;
              setBusy(label);
              try {
                await setThisWeek({ propertyId, label });
                toast.success(`This week uses Menu ${label}.`);
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(null);
              }
            }}
          >
            Menu {label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function MenuEditor({ data, propertyId, propertyName }: { data: MenuData; propertyId: Id<"properties">; propertyName: string }) {
  const save = useMutation(api.menus.save);
  const saved: Record<Label, Draft> = { A: toDraft(data.menus[0].entries), B: toDraft(data.menus[1].entries) };
  const [drafts, setDrafts] = useState<Record<Label, Draft>>(saved);
  const [tab, setTab] = useState<Label>("A");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = (["A", "B"] as const).filter((label) => !same(drafts[label], saved[label]));

  async function saveAll() {
    setBusy(true);
    setError(null);
    try {
      for (const label of changed) await save({ propertyId, label, entries: toEntries(drafts[label]) });
      toast.success(changed.length === 2 ? "Both menus saved." : `Menu ${changed[0]} saved.`);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Edit menus">
      <ExcelCard
        drafts={drafts}
        propertyName={propertyName}
        onLoaded={(grids) => {
          setDrafts(grids);
          setError(null);
        }}
      />
      <div role="tablist" aria-label="Menus" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 sm:w-80">
        {(["A", "B"] as const).map((label) => (
          <button
            key={label}
            role="tab"
            type="button"
            aria-selected={tab === label}
            onClick={() => setTab(label)}
            className={cn(
              "min-h-11 rounded-sm text-sm font-medium transition-colors",
              tab === label ? "bg-surface text-foreground shadow-sm" : "text-foreground-secondary hover:text-foreground",
            )}
          >
            Menu {label}
            {changed.includes(label) ? " •" : ""}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={`Menu ${tab}`} className="grid gap-3 lg:grid-cols-2">
        {WEEKDAYS.map((weekday) => (
          <Card key={weekday} className="flex flex-col gap-3 p-4">
            <h2 className="font-semibold">{WEEKDAY_NAMES[weekday]}</h2>
            {MEAL_TYPES.map((mealType) => {
              const id = `menu-${tab}-${weekday}-${mealType}`;
              return (
                <div key={mealType} className="flex items-center gap-3">
                  <label htmlFor={id} className="flex w-28 shrink-0 items-center gap-2 text-sm text-foreground-secondary">
                    <Icon icon={MEAL_ICONS[mealType]} />
                    {MEAL_NAMES[mealType]}
                  </label>
                  <Input
                    id={id}
                    aria-label={`Menu ${tab}, ${WEEKDAY_NAMES[weekday]}, ${MEAL_NAMES[mealType]}`}
                    maxLength={200}
                    placeholder="e.g. Poha, tea"
                    value={drafts[tab][key(weekday, mealType)] ?? ""}
                    onChange={(e) =>
                      setDrafts((current) => ({
                        ...current,
                        [tab]: { ...current[tab], [key(weekday, mealType)]: e.target.value },
                      }))
                    }
                  />
                </div>
              );
            })}
          </Card>
        ))}
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 -mb-10 flex flex-col gap-3 border-t border-border bg-surface px-4 py-3 md:-mx-8 md:px-8">
        {error ? <Banner tone="danger" title="Not saved">{error}</Banner> : null}
        <div className="flex items-center gap-3">
          <p
            className={cn("flex-1 text-sm", changed.length > 0 ? "font-medium text-warning" : "text-foreground-secondary")}
            role="status"
          >
            {changed.length === 0
              ? "All changes saved."
              : `Unsaved changes in ${changed.map((l) => `Menu ${l}`).join(" and ")}`}
          </p>
          <Button onClick={saveAll} loading={busy} disabled={changed.length === 0} className="min-w-28">
            Save
          </Button>
        </div>
      </div>
    </section>
  );
}

const EXCEL_MEALS = MEAL_TYPES.map((mealType) => ({ mealType, name: MEAL_NAMES[mealType] }));

/** Download both menus as an Excel file (the format to fill in), or fill the editor from one. */
function ExcelCard({
  drafts,
  propertyName,
  onLoaded,
}: {
  drafts: Record<Label, Draft>;
  propertyName: string;
  onLoaded: (grids: Record<Label, Draft>) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"download" | "upload" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const slug = propertyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pg";
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Icon icon={FileSpreadsheet} className="mt-0.5 text-foreground-secondary" />
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium">Use Excel</h2>
          <p className="text-sm text-foreground-secondary">
            Download the menus as an Excel file (two sheets, Menu A and Menu B: days down the side, meals across the
            top), fill it in, and upload it. The menus below fill in from the file; check them, then press Save.
          </p>
        </div>
      </div>
      {problem ? <Banner tone="danger" title="Couldn't read the file">{problem}</Banner> : null}
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          variant="secondary"
          loading={busy === "download"}
          onClick={async () => {
            setBusy("download");
            try {
              downloadBlob(await menuWorkbook(drafts, EXCEL_MEALS), `dine-menu-${slug}.xlsx`);
            } catch (error) {
              toast.error(friendlyError(error));
            } finally {
              setBusy(null);
            }
          }}
        >
          <Icon icon={Download} />
          Download
        </Button>
        <Button variant="secondary" loading={busy === "upload"} onClick={() => file.current?.click()}>
          <Icon icon={Upload} />
          Upload
        </Button>
        <input
          ref={file}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          aria-label="Upload a menu Excel file"
          tabIndex={-1}
          onChange={async (event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (!chosen) return;
            setBusy("upload");
            setProblem(null);
            try {
              onLoaded(await readMenuWorkbook(chosen, EXCEL_MEALS));
              toast.success("Menus filled in from the file. Check them, then press Save.");
            } catch (error) {
              setProblem(error instanceof Error ? error.message : "That file couldn't be read.");
            } finally {
              setBusy(null);
            }
          }}
        />
      </div>
    </Card>
  );
}
