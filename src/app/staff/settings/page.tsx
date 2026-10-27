"use client";

import { useMutation, useQuery } from "convex/react";
import { Bell, Building2, Clock, MessageSquareHeart, Palette, Plus, Trash2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { RequireStaff } from "@/components/app/staff-gate";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input, inputClasses } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

type SettingsData = FunctionReturnType<typeof api.settings.get>;

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "pg", label: "PG details", icon: Building2 },
  { id: "meals", label: "Meals & deadline", icon: Clock },
  { id: "reminders", label: "Phone reminders", icon: Bell },
  { id: "messages", label: "Resident messages", icon: MessageSquareHeart },
];

export default function SettingsPage() {
  return (
    <RequireStaff roles={[]}>
      <Suspense fallback={<LoadingState rows={3} />}>
        <Settings />
      </Suspense>
    </RequireStaff>
  );
}

function Settings() {
  const data = useQuery(api.settings.get);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const section = SECTIONS.find((s) => s.id === params.get("section")) ?? SECTIONS[0];
  return (
    <>
      <PageHeader title="Settings" description="Only the Admin sees this page." />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
        <nav aria-label="Settings sections" className="-mx-1 overflow-x-auto lg:mx-0 lg:w-56 lg:shrink-0">
          <ul className="flex gap-1 px-1 lg:flex-col lg:px-0">
            {SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={s === section ? "page" : undefined}
                  onClick={() => router.replace(s === SECTIONS[0] ? pathname : `${pathname}?section=${s.id}`, { scroll: false })}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm font-medium whitespace-nowrap transition-colors",
                    s === section ? "bg-primary-subtle text-primary-text" : "text-foreground-secondary hover:bg-subtle hover:text-foreground",
                  )}
                >
                  <Icon icon={s.icon} className="size-4" />
                  {s.label}
                </button>
              </li>
            ))}
            <li className="shrink-0 lg:mt-2 lg:border-t lg:border-border lg:pt-2">
              <Link
                href="/design"
                className="flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-foreground-secondary hover:bg-subtle hover:text-foreground"
              >
                <Icon icon={Palette} className="size-4" />
                Design system
              </Link>
            </li>
          </ul>
        </nav>
        <div className="flex min-w-0 max-w-xl flex-1 flex-col gap-4">
          {data === undefined ? (
            <LoadingState rows={3} />
          ) : section.id === "pg" ? (
            <PgDetailsForm initial={data} />
          ) : section.id === "meals" ? (
            <MealsForm initial={data} />
          ) : section.id === "reminders" ? (
            <RemindersForm initial={data} />
          ) : (
            <ResidentMessagesForm initial={data} />
          )}
        </div>
      </div>
    </>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
      <p className="text-sm text-foreground-secondary">{description}</p>
    </div>
  );
}

/** Shared submit handling: busy state, error banner, success toast. */
function useSave(save: () => Promise<unknown>, success: (result: unknown) => string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      toast.success(success(await save()));
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, onSubmit };
}

function PgDetailsForm({ initial }: { initial: SettingsData }) {
  const update = useMutation(api.settings.update);
  const [organizationName, setOrganizationName] = useState(initial.organizationName);
  const [propertyName, setPropertyName] = useState(initial.propertyName);
  const { busy, error, onSubmit } = useSave(() => update({ organizationName, propertyName }), () => "Details saved.");
  const changed = organizationName !== initial.organizationName || propertyName !== initial.propertyName;
  return (
    <>
      <SectionHeading title="PG details" description="Your organisation and PG names. Residents and staff see the PG name." />
      <Card>
        <CardBody>
          <form noValidate className="flex flex-col gap-4" onSubmit={onSubmit}>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <Field id="org-name" label="Organisation name" hint="Your business name.">
              {(p) => <Input {...p} maxLength={80} value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} />}
            </Field>
            <Field id="pg-name" label="PG name" hint="Shown at the top of every screen.">
              {(p) => <Input {...p} maxLength={80} value={propertyName} onChange={(e) => setPropertyName(e.target.value)} />}
            </Field>
            <Button type="submit" loading={busy} disabled={!changed} className="self-start">
              Save
            </Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WARN_OPTIONS = [
  [30, "30 minutes"],
  [60, "1 hour"],
  [120, "2 hours"],
  [180, "3 hours"],
  [240, "4 hours"],
  [360, "6 hours"],
] as const;

type MealSetting = SettingsData["meals"][number];

function MealsForm({ initial }: { initial: SettingsData }) {
  const update = useMutation(api.settings.updateMeals);
  const [meals, setMeals] = useState(initial.meals);
  const [daysBefore, setDaysBefore] = useState(initial.cutoff.daysBefore);
  const [cutoffTime, setCutoffTime] = useState(initial.cutoff.time);
  const [warnMinutes, setWarnMinutes] = useState(initial.warnMinutes);
  const changed =
    JSON.stringify(meals) !== JSON.stringify(initial.meals) ||
    daysBefore !== initial.cutoff.daysBefore ||
    cutoffTime !== initial.cutoff.time ||
    warnMinutes !== initial.warnMinutes;
  const { busy, error, onSubmit } = useSave(
    () =>
      update({
        meals: meals.map(({ mealType, displayName, serviceTime, endTime, serviceDays, active }) => ({
          mealType,
          displayName,
          serviceTime,
          endTime,
          serviceDays,
          active,
        })),
        cutoff: { daysBefore, time: cutoffTime },
        warnMinutes,
      }),
    (result) => {
      const n = (result as { openMealsUpdated: number }).openMealsUpdated;
      return n > 0 ? `Saved. ${n} coming meal${n === 1 ? "" : "s"} still open for choosing updated too.` : "Saved.";
    },
  );
  const setMeal = (i: number, change: Partial<MealSetting>) =>
    setMeals((current) => current.map((m, j) => (j === i ? { ...m, ...change } : m)));

  return (
    <>
      <SectionHeading
        title="Meals & deadline"
        description="Which meals are served, on which days and when, and until when residents can choose. Times are in the PG's time zone."
      />
      <form noValidate className="flex flex-col gap-4" onSubmit={onSubmit}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {meals.map((meal, i) => (
          <Card key={meal.mealType}>
            <CardBody className="flex flex-col gap-4">
              <div className="flex items-end gap-3">
                <Field id={`${meal.mealType}-name`} label="Meal name" className="flex-1">
                  {(p) => <Input {...p} maxLength={30} value={meal.displayName} onChange={(e) => setMeal(i, { displayName: e.target.value })} />}
                </Field>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={meal.active}
                    onChange={(e) => setMeal(i, { active: e.target.checked })}
                  />
                  Served
                </label>
              </div>
              {meal.active ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id={`${meal.mealType}-start`} label="Starts">
                      {(p) => <Input {...p} type="time" value={meal.serviceTime} onChange={(e) => setMeal(i, { serviceTime: e.target.value })} />}
                    </Field>
                    <Field id={`${meal.mealType}-end`} label="Ends">
                      {(p) => <Input {...p} type="time" value={meal.endTime} onChange={(e) => setMeal(i, { endTime: e.target.value })} />}
                    </Field>
                  </div>
                  <div role="group" aria-label={`Days ${meal.displayName || "this meal"} is served`} className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Days</span>
                    <div className="grid grid-cols-7 gap-1">
                      {WEEKDAYS.map((day, d) => {
                        const on = meal.serviceDays.includes(d);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={on}
                            aria-label={day}
                            onClick={() =>
                              setMeal(i, {
                                serviceDays: on ? meal.serviceDays.filter((x) => x !== d) : [...meal.serviceDays, d].sort(),
                              })
                            }
                            className={cn(
                              "min-h-11 rounded-md border text-xs font-medium transition-colors",
                              on
                                ? "border-primary bg-primary-subtle text-primary-text"
                                : "border-border bg-surface text-foreground-muted hover:bg-subtle",
                            )}
                          >
                            {day.slice(0, 2)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-foreground-secondary">Not served. Residents won&apos;t see it.</p>
              )}
            </CardBody>
          </Card>
        ))}
        <Card>
          <CardBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold">Deadline to choose</h3>
              <p className="text-sm text-foreground-secondary">
                Shown to residents; after it, their choices for the day are locked. Now:{" "}
                {daysBefore === 0 ? "on the day" : "the day before"}, at {cutoffTime ? formatClock(cutoffTime) : "–"}.
              </p>
            </div>
            <div className="grid grid-cols-2 items-end gap-3">
              <Field id="cutoff-day" label="Day">
                {(p) => (
                  <NativeSelect {...p} value={daysBefore} onChange={(e) => setDaysBefore(Number(e.target.value))}>
                    <option value={0}>On the day</option>
                    <option value={1}>The day before</option>
                  </NativeSelect>
                )}
              </Field>
              <Field id="cutoff-time" label="Time">
                {(p) => <Input {...p} type="time" value={cutoffTime} onChange={(e) => setCutoffTime(e.target.value)} />}
              </Field>
            </div>
            <Field id="warn" label="Warn residents" hint="Their screen turns amber this long before the deadline if something is unanswered.">
              {(p) => (
                <NativeSelect {...p} value={warnMinutes} onChange={(e) => setWarnMinutes(Number(e.target.value))}>
                  {WARN_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label} before
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </CardBody>
        </Card>
        <p className="text-sm text-foreground-secondary">
          Changes also apply to coming days that are still open for choosing. Days that have already closed keep what
          they had, so past counts don&apos;t change. A meal you stop serving on an open day is removed, or shown as not
          served if someone already answered for it.
        </p>
        <Button type="submit" loading={busy} disabled={!changed} className="self-start">
          Save meals
        </Button>
      </form>
    </>
  );
}

const MAX_REMINDERS = 4;

function RemindersForm({ initial }: { initial: SettingsData }) {
  const update = useMutation(api.settings.updateReminders);
  const [enabled, setEnabled] = useState(initial.reminders.enabled);
  const [times, setTimes] = useState(initial.reminders.times);
  const changed = enabled !== initial.reminders.enabled || times.join() !== initial.reminders.times.join();
  const { busy, error, onSubmit } = useSave(
    () => update({ enabled, times: times.filter((t) => t !== "") }),
    () => (enabled ? "Saved. Reminders go out at the new times." : "Saved. Reminders are off."),
  );
  const n = initial.residentsWithReminders;
  return (
    <>
      <SectionHeading
        title="Phone reminders"
        description="A notification on residents' phones if they haven't chosen their meals yet. Only residents who haven't answered are reminded."
      />
      <form noValidate className="flex flex-col gap-4" onSubmit={onSubmit}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Card>
          <CardBody className="flex flex-col gap-4">
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="font-medium">Send reminders</span>
            </label>
            <fieldset disabled={!enabled} className="flex flex-col gap-3 disabled:opacity-60">
              <legend className="mb-2 text-sm font-medium">Times (every day)</legend>
              {times.map((time, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label={`Reminder ${i + 1}`}
                    className="w-40"
                    value={time}
                    onChange={(e) => setTimes((current) => current.map((t, j) => (j === i ? e.target.value : t)))}
                  />
                  <span className="text-sm text-foreground-secondary">{time ? formatClock(time) : ""}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove reminder ${i + 1}`}
                    onClick={() => setTimes((current) => current.filter((_, j) => j !== i))}
                    disabled={times.length === 1}
                  >
                    <Icon icon={Trash2} />
                  </Button>
                </div>
              ))}
              {times.length < MAX_REMINDERS ? (
                <Button type="button" variant="secondary" className="self-start" onClick={() => setTimes([...times, "20:00"])}>
                  <Icon icon={Plus} />
                  Add a time
                </Button>
              ) : null}
            </fieldset>
          </CardBody>
        </Card>
        <p className="text-sm text-foreground-secondary">
          Residents turn reminders on from their Profile, on each phone they use. {n === 0 ? "No residents have" : n === 1 ? "1 resident has" : `${n} residents have`} turned them on so far.
          A reminder is about the next day that&apos;s still open, and says the deadline.
        </p>
        <Button type="submit" loading={busy} disabled={!changed} className="self-start">
          Save reminders
        </Button>
      </form>
    </>
  );
}

/** The question of the day (three, taking turns) and the message about food waste. */
function ResidentMessagesForm({ initial }: { initial: SettingsData }) {
  const update = useMutation(api.settings.updateResidentMessages);
  const start = [0, 1, 2].map((i) => initial.questions[i] ?? "");
  const [questions, setQuestions] = useState(start);
  const [wasteMessage, setWasteMessage] = useState(initial.wasteMessage);
  const { busy, error, onSubmit } = useSave(
    () => update({ questions, wasteMessage }),
    () => "Saved. Residents see it straight away.",
  );
  const changed = questions.some((q, i) => q !== start[i]) || wasteMessage !== initial.wasteMessage;
  return (
    <>
      <SectionHeading
        title="Resident messages"
        description="What residents see above and below their meals. One question each day, taking turns: 1, then 2, then 3, then 1 again."
      />
      <Card>
        <CardBody>
          <form noValidate className="flex flex-col gap-4" onSubmit={onSubmit}>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            {questions.map((question, i) => (
              <Field key={i} id={`question-${i}`} label={`Question ${i + 1}`}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={120}
                    value={question}
                    onChange={(e) => setQuestions((current) => current.map((q, j) => (j === i ? e.target.value : q)))}
                  />
                )}
              </Field>
            ))}
            <Field id="waste-message" label="Message about food waste" hint="Shown under the meals every day. Up to 600 characters.">
              {(p) => (
                <textarea
                  {...p}
                  rows={5}
                  maxLength={600}
                  className={cn(inputClasses, "h-auto py-2.5 leading-relaxed")}
                  value={wasteMessage}
                  onChange={(e) => setWasteMessage(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" loading={busy} disabled={!changed} className="self-start">
              Save
            </Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
