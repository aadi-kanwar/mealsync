"use client";

import { Check, CircleDashed, Clock, Info, Lock, Plus, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import { RequireStaff } from "@/components/app/staff-gate";
import { STAFF_NAV } from "@/components/nav/nav-items";
import { BottomNav, StaffSidebar } from "@/components/nav/staff-nav";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FilterBar, SearchInput } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { MealCard } from "@/components/ui/meal-card";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordInput } from "@/components/ui/password-input";
import { LoadingState, Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, ErrorState, NotAuthorizedState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { YesNoToggle, type YesNo } from "@/components/ui/yes-no-toggle";

/** Internal reference: every token and component, in every state. Staff-only (open in local development). */
export default function DesignPage() {
  if (process.env.NODE_ENV === "development") return <DesignSystem />;
  return (
    <div className="mx-auto max-w-5xl p-4">
      <RequireStaff roles={["warden", "kitchen"]}>
        <DesignSystem />
      </RequireStaff>
    </div>
  );
}

// Class names are written out in full so Tailwind can find them.
const COLOR_TOKENS = [
  ["background", "bg-background"],
  ["surface", "bg-surface"],
  ["subtle", "bg-subtle"],
  ["muted", "bg-muted"],
  ["border", "bg-border"],
  ["border-strong", "bg-border-strong"],
  ["disabled", "bg-disabled"],
  ["foreground-muted", "bg-foreground-muted"],
  ["foreground-secondary", "bg-foreground-secondary"],
  ["foreground", "bg-foreground"],
  ["primary", "bg-primary"],
  ["primary-hover", "bg-primary-hover"],
  ["primary-subtle", "bg-primary-subtle"],
  ["success-subtle", "bg-success-subtle"],
  ["warning-subtle", "bg-warning-subtle"],
  ["danger", "bg-danger"],
  ["danger-subtle", "bg-danger-subtle"],
  ["info-subtle", "bg-info-subtle"],
] as const;

const TYPE_SCALE = [
  ["2xl · 28/36 · semibold", "text-2xl font-semibold"],
  ["xl · 22/28 · semibold", "text-xl font-semibold"],
  ["lg · 18/26 · medium", "text-lg font-medium"],
  ["base · 16/24 · regular", "text-base"],
  ["sm · 14/20 · regular", "text-sm"],
  ["xs · 12/16 · medium", "text-xs font-medium"],
] as const;

const SPACING = [
  ["1 · 4px", "w-1"],
  ["2 · 8px", "w-2"],
  ["3 · 12px", "w-3"],
  ["4 · 16px", "w-4"],
  ["6 · 24px", "w-6"],
  ["8 · 32px", "w-8"],
  ["12 · 48px", "w-12"],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-border pb-2 text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-foreground-muted">{label}</span>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

function DesignSystem() {
  const [choice, setChoice] = useState<YesNo | null>(null);
  const [mealChoice, setMealChoice] = useState<YesNo | null>("yes");
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8">
      <PageHeader
        title="Design system"
        description="Every MealSync colour, size and component. If a screen looks different from this page, the screen is wrong."
      />

      <Section title="Colour tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {COLOR_TOKENS.map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className={`h-12 rounded-sm border border-border ${cls}`} />
              <span className="text-xs text-foreground-secondary">{name}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-foreground-secondary">
          One accent (muted green) for primary actions and “Yes”. Text colours meet WCAG AA (4.5:1) on every
          background they are used on.
        </p>
      </Section>

      <Section title="Typography (Geist, six sizes)">
        <div className="flex flex-col gap-3">
          {TYPE_SCALE.map(([label, cls]) => (
            <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-6">
              <span className="w-48 shrink-0 text-xs text-foreground-muted">{label}</span>
              <span className={cls}>Tomorrow&apos;s breakfast</span>
            </div>
          ))}
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-6">
            <span className="w-48 shrink-0 text-xs text-foreground-muted">tabular numbers</span>
            <span className="tabular text-xl font-semibold">118 · 104 · 9 · 5</span>
          </div>
        </div>
      </Section>

      <Section title="Spacing (4px base), radius, shadow, icon">
        <div className="flex flex-wrap items-end gap-6">
          {SPACING.map(([label, cls]) => (
            <div key={label} className="flex flex-col items-start gap-1.5">
              <div className={`h-6 bg-primary ${cls}`} />
              <span className="text-xs text-foreground-muted">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="flex flex-col gap-1.5">
            <div className="size-16 rounded-sm border border-border-strong bg-surface" />
            <span className="text-xs text-foreground-muted">radius-sm · 6px</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="size-16 rounded-md border border-border-strong bg-surface" />
            <span className="text-xs text-foreground-muted">radius-md · 10px</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="size-16 rounded-md bg-surface shadow-sm" />
            <span className="text-xs text-foreground-muted">shadow-sm</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="size-16 rounded-md bg-surface shadow-lg" />
            <span className="text-xs text-foreground-muted">shadow-lg (dialogs)</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex size-16 items-center justify-center gap-1 rounded-md border border-border">
              <Icon icon={Clock} />
              <Icon icon={Users} />
            </div>
            <span className="text-xs text-foreground-muted">Lucide · 18px · 1.75 stroke</span>
          </div>
        </div>
      </Section>

      <Section title="Buttons (44px tall minimum)">
        {(["primary", "secondary", "ghost", "destructive"] as const).map((variant) => (
          <Row key={variant} label={variant}>
            <Button variant={variant}>
              <Icon icon={variant === "destructive" ? Trash2 : Plus} />
              Default
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} loading>
              Saving
            </Button>
          </Row>
        ))}
        <Row label="icon only">
          <Button variant="secondary" size="icon" aria-label="Add">
            <Icon icon={Plus} />
          </Button>
        </Row>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="d-default" label="Text input" hint="Hint text explains what to enter.">
            {(p) => <Input {...p} placeholder="Placeholder" />}
          </Field>
          <Field id="d-error" label="With an error" error="Enter your room number.">
            {(p) => <Input {...p} defaultValue="" />}
          </Field>
          <Field id="d-disabled" label="Disabled">
            {(p) => <Input {...p} disabled defaultValue="Can't change this" />}
          </Field>
          <Field id="d-password" label="Password input">
            {(p) => <PasswordInput {...p} defaultValue="example-pass" />}
          </Field>
          <Field id="d-select" label="Select">
            {(p) => (
              <NativeSelect {...p} defaultValue="warden">
                <option value="admin">Admin</option>
                <option value="warden">Warden</option>
                <option value="kitchen">Kitchen</option>
              </NativeSelect>
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">OTP input</span>
            <p className="text-sm text-foreground-secondary">
              Not used: by the owner&apos;s decision, login is phone number + password, so there is no SMS code
              to type.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Yes / No toggle">
        <div className="grid gap-6 sm:grid-cols-2">
          <Row label={`interactive (current: ${choice ?? "not answered"})`}>
            <div className="w-full">
              <YesNoToggle label="Example" value={choice} onChange={setChoice} />
            </div>
          </Row>
          <Row label="yes">
            <div className="w-full">
              <YesNoToggle label="Yes example" value="yes" />
            </div>
          </Row>
          <Row label="no">
            <div className="w-full">
              <YesNoToggle label="No example" value="no" />
            </div>
          </Row>
          <Row label="locked">
            <div className="w-full">
              <YesNoToggle label="Locked example" value="yes" disabled />
            </div>
          </Row>
        </div>
      </Section>

      <Section title="Meal cards">
        <div className="grid gap-3 sm:grid-cols-2">
          <MealCard name="Breakfast" time="8:00 AM" value={mealChoice} onChange={setMealChoice} />
          <MealCard name="Lunch" time="1:00 PM" value="no" onChange={() => {}} />
          <MealCard name="Snacks" time="5:00 PM" value={null} onChange={() => {}} />
          <MealCard name="Dinner" time="8:30 PM" value="yes" locked />
        </div>
      </Section>

      <Section title="Status badges (icon + text, never colour alone)">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="primary" icon={Check}>Yes</StatusBadge>
          <StatusBadge tone="neutral" icon={X}>No</StatusBadge>
          <StatusBadge tone="warning" icon={CircleDashed}>Not answered</StatusBadge>
          <StatusBadge tone="neutral" icon={Lock}>Locked</StatusBadge>
          <StatusBadge tone="success" icon={Check}>Finalized</StatusBadge>
          <StatusBadge tone="danger" icon={X}>Needs review</StatusBadge>
          <StatusBadge tone="info" icon={Info}>Draft</StatusBadge>
        </div>
      </Section>

      <Section title="Stat cards">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Eligible" value={118} />
          <StatCard label="Yes" value={96} emphasis />
          <StatCard label="No" value={14} />
          <StatCard label="Not answered" value={8} hint="Chase these" />
        </div>
      </Section>

      <Section title="Banners">
        <Banner tone="info" title="Information">Something worth knowing.</Banner>
        <Banner tone="success" title="Saved at 8:14 PM" />
        <Banner tone="warning" title="Cutoff in 45 minutes">You haven&apos;t answered snacks and dinner.</Banner>
        <Banner tone="danger" title="Counts don't add up">Eligible ≠ Yes + No + Not answered.</Banner>
      </Section>

      <Section title="Filter bar and table">
        <FilterBar>
          <SearchInput label="Search by name or room" placeholder="Search name or room" />
          <div className="sm:w-48">
            <NativeSelect aria-label="Meal" defaultValue="all">
              <option value="all">All meals</option>
              <option value="breakfast">Breakfast</option>
            </NativeSelect>
          </div>
          <Button variant="secondary">Export CSV</Button>
        </FilterBar>
        <Table>
          <THead>
            <TR>
              <TH>Room</TH>
              <TH>Name</TH>
              <TH className="text-right">Yes</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD className="tabular">101</TD>
              <TD>Asha Rao</TD>
              <TD className="tabular text-right">3</TD>
              <TD>
                <StatusBadge tone="primary" icon={Check}>Answered</StatusBadge>
              </TD>
            </TR>
            <TR>
              <TD className="tabular">204</TD>
              <TD>Vikram Singh</TD>
              <TD className="tabular text-right">0</TD>
              <TD>
                <StatusBadge tone="warning" icon={CircleDashed}>Not answered</StatusBadge>
              </TD>
            </TR>
          </TBody>
        </Table>
      </Section>

      <Section title="Loading, empty, error and no-access states">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <span className="text-xs font-medium text-foreground-muted">loading skeleton</span>
              <LoadingState rows={2} />
              <Skeleton className="h-4 w-1/2" />
              <Spinner label="Loading" />
            </CardBody>
          </Card>
          <EmptyState title="No one is waiting" description="New sign-ups will appear here automatically." />
          <ErrorState onRetry={() => toast("Retrying…")} />
          <NotAuthorizedState />
        </div>
      </Section>

      <Section title="Toast and dialog">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast.success("Saved at 8:14 PM")}>
            Show success toast
          </Button>
          <Button variant="secondary" onClick={() => toast.error("Couldn't save. Your last saved choices are kept.")}>
            Show error toast
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent title="Approve Asha Rao" description="Check the room number and start date.">
              <Field id="d-dialog-room" label="Room number">
                {(p) => <Input {...p} defaultValue="101" />}
              </Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>Approve</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Section>

      <Section title="Page header, staff sidebar and mobile bottom navigation">
        <Card>
          <CardBody>
            <PageHeader
              title="Kitchen report"
              description="Tuesday, 3 November"
              actions={<Button variant="secondary">Print</Button>}
            />
          </CardBody>
        </Card>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="overflow-hidden rounded-md border border-border">
            <StaffSidebar items={STAFF_NAV} preview />
          </div>
          <div className="w-full max-w-sm self-start overflow-hidden rounded-md border border-border">
            <BottomNav items={STAFF_NAV} preview />
          </div>
        </div>
      </Section>
    </main>
  );
}
