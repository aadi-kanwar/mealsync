"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Copy, DoorOpen, KeyRound, LogOut, Undo2, UserRoundCheck } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/time";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { useMe } from "@/components/app/session";
import { RequireStaff } from "@/components/app/staff-gate";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { formatDay, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = FunctionReturnType<typeof api.residents.list>[number];

export default function ResidentsPage() {
  return (
    <RequireStaff roles={["warden"]}>
      <Residents />
    </RequireStaff>
  );
}

function Residents() {
  const me = useMe();
  const today = todayIn(me?.property?.timezone);
  const rows = useQuery(api.residents.list);
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const inTab = rows?.filter((r) => r.status === tab) ?? [];
  const shown = inTab.filter(
    (r) => term === "" || r.displayName.toLowerCase().includes(term) || r.roomNumber.toLowerCase().includes(term),
  );
  const count = (status: Row["status"]) => rows?.filter((r) => r.status === status).length ?? 0;

  return (
    <>
      <PageHeader
        title="Residents"
        description="Approved residents. Mark someone as moved out so they stop being counted, or reset a forgotten password."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Which residents" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 sm:w-80">
          {(
            [
              ["active", "Current"],
              ["inactive", "Moved out"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "min-h-11 rounded-sm text-sm font-medium transition-colors",
                tab === value ? "bg-surface text-foreground shadow-sm" : "text-foreground-secondary hover:text-foreground",
              )}
            >
              {label} <span className="tabular">({count(value)})</span>
            </button>
          ))}
        </div>
        <SearchInput label="Search by name or room" placeholder="Name or room" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {rows === undefined ? (
        <LoadingState />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={UserRoundCheck}
          title={term ? "No one matches that search" : tab === "active" ? "No current residents yet" : "No one has moved out"}
          description={tab === "active" && !term ? "Approved sign-ups appear here." : undefined}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label={tab === "active" ? "Current residents" : "Moved out"}>
            {shown.map((row) => (
              <ResidentRow key={row.residentId} row={row} today={today} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function ResidentRow({ row, today }: { row: Row; today: string }) {
  const leaving = row.status === "active" && row.validUntil !== null;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.displayName}</span>
          {leaving ? (
            <StatusBadge tone="warning" icon={LogOut}>
              Last day {formatDay(row.validUntil!)}
            </StatusBadge>
          ) : null}
          {row.status === "inactive" && row.validUntil ? (
            <StatusBadge tone="neutral" icon={DoorOpen}>
              Moved out after {formatDay(row.validUntil)}
            </StatusBadge>
          ) : null}
          {row.mustChangePassword ? (
            <StatusBadge tone="info" icon={KeyRound}>
              Temporary password
            </StatusBadge>
          ) : null}
        </div>
        <span className="text-sm text-foreground-secondary">
          Room {row.roomNumber}
          {row.phone ? <> · <span className="tabular">{formatPhoneForDisplay(row.phone)}</span></> : null}
        </span>
      </div>
      {row.status === "active" ? (
        <div className="grid grid-cols-2 gap-2 sm:flex">
          {leaving ? <UndoMoveOutDialog row={row} /> : <MoveOutDialog row={row} today={today} />}
          {row.canResetPassword ? <ResetPasswordDialog row={row} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function MoveOutDialog({ row, today }: { row: Row; today: string }) {
  const moveOut = useMutation(api.residents.moveOut);
  const [open, setOpen] = useState(false);
  const [lastDay, setLastDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLastDay(today);
          setServerError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={LogOut} />
          Moved out
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`${row.displayName} is moving out`}
        description="They're counted for meals up to and including their last day, and not after. Their history is kept."
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setServerError(null);
            try {
              await moveOut({ residentId: row.residentId, lastDay });
              toast.success(`${row.displayName}'s last day is ${formatDay(lastDay)}.`);
              setOpen(false);
            } catch (error) {
              setServerError(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          <Field id={`last-${row.residentId}`} label="Last day eating here" hint="Yesterday at the earliest.">
            {(p) => (
              <Input
                {...p}
                type="date"
                min={addDays(today, -1)}
                value={lastDay}
                onChange={(e) => setLastDay(e.target.value)}
              />
            )}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={busy} disabled={lastDay === ""}>
              Confirm move-out
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UndoMoveOutDialog({ row }: { row: Row }) {
  const cancelMoveOut = useMutation(api.residents.cancelMoveOut);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={Undo2} />
          Undo move-out
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Keep ${row.displayName}?`}
        description="Their last day is removed and they keep being counted as a current resident."
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
                await cancelMoveOut({ residentId: row.residentId });
                toast.success(`${row.displayName} stays a current resident.`);
                setOpen(false);
              } catch (error) {
                setServerError(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Undo move-out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ row }: { row: Row }) {
  const resetPassword = useAction(api.residents.resetPassword);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [temporary, setTemporary] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTemporary(null); // never keep it on screen after closing
        setServerError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={KeyRound} />
          Reset password
        </Button>
      </DialogTrigger>
      {temporary === null ? (
        <DialogContent
          title={`Reset ${row.displayName}'s password?`}
          description="They'll get a temporary password from you, and must choose their own when they next sign in. Any phone they're signed in on is signed out."
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
                  setTemporary((await resetPassword({ residentId: row.residentId })).temporaryPassword);
                } catch (error) {
                  setServerError(friendlyError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : (
        <DialogContent
          title="Temporary password"
          description={`Tell it to ${row.displayName} in person. It won't be shown again.`}
        >
          <p
            className="rounded-md border border-border bg-subtle px-4 py-3 text-center font-mono text-2xl tracking-widest select-all"
            aria-label={`Temporary password: ${temporary.split("").join(" ")}`}
          >
            {temporary}
          </p>
          <p className="text-sm text-foreground-secondary">
            They sign in with their mobile number and this password, then choose a new one.
          </p>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(temporary);
                  toast.success("Copied.");
                } catch {
                  toast.error("Couldn't copy. Please read it out instead.");
                }
              }}
            >
              <Icon icon={Copy} />
              Copy
            </Button>
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
