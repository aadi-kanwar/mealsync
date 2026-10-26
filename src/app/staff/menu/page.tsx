"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/time";
import { MEAL_TYPES, type MealType } from "@convex/lib/validators";
import { MEAL_ICONS } from "@/components/app/meal-shared";
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
import { cn } from "@/lib/utils";

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
  const data = useQuery(api.menus.get);
  return (
    <>
      <PageHeader
        title="Menu"
        description="Fill in your two weekly menus. They take turns week by week (Monday to Sunday), and residents see each meal's dishes."
      />
      {data === undefined ? (
        <LoadingState rows={4} />
      ) : (
        <>
          <Rotation data={data} />
          <MenuEditor data={data} />
        </>
      )}
    </>
  );
}

function Rotation({ data }: { data: MenuData }) {
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
                await setThisWeek({ label });
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

function MenuEditor({ data }: { data: MenuData }) {
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
      for (const label of changed) await save({ label, entries: toEntries(drafts[label]) });
      toast.success(changed.length === 2 ? "Both menus saved." : `Menu ${changed[0]} saved.`);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Edit menus">
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

      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-col gap-3 border-t border-border bg-surface px-4 py-3 md:bottom-0 md:-mx-8 md:px-8">
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
