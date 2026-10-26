"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { Check, UserCheck, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatPhoneForDisplay, isoDateSchema, roomNumberSchema } from "@convex/lib/inputRules";
import { RequireStaff } from "@/components/app/staff-gate";
import { useMe } from "@/components/app/session";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { formatDateTime, todayIn } from "@/lib/format";

export default function SignupsPage() {
  return (
    <RequireStaff roles={["warden"]}>
      <Signups />
    </RequireStaff>
  );
}

type Pending = {
  residentId: Id<"residents">;
  displayName: string;
  roomNumber: string;
  phone: string | null;
  signedUpAt: number;
};

function Signups() {
  const me = useMe();
  const pending = useQuery(api.residents.listPending);
  const timezone = me?.property?.timezone;
  return (
    <>
      <PageHeader
        title="New sign-ups"
        description="People who created an account. They can't choose meals and aren't counted until you approve them."
      />
      {pending === undefined ? (
        <LoadingState />
      ) : pending.length === 0 ? (
        <EmptyState icon={UserCheck} title="No one is waiting" description="New sign-ups will appear here automatically." />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Waiting for approval">
          {pending.map((person) => (
            <li key={person.residentId}>
              <PendingRow person={person} timezone={timezone} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PendingRow({ person, timezone }: { person: Pending; timezone?: string }) {
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="sr-only">Name</dt>
        <dd className="col-span-2 text-base font-medium">{person.displayName}</dd>
        <dt className="text-foreground-secondary">Room</dt>
        <dd>{person.roomNumber}</dd>
        <dt className="text-foreground-secondary">Phone</dt>
        <dd className="tabular">{person.phone ? formatPhoneForDisplay(person.phone) : "Not available"}</dd>
        <dt className="text-foreground-secondary">Signed up</dt>
        <dd>{formatDateTime(person.signedUpAt, timezone)}</dd>
      </dl>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <RejectDialog person={person} />
        <ApproveDialog person={person} timezone={timezone} />
      </div>
    </Card>
  );
}

const approveSchema = z.object({ roomNumber: roomNumberSchema, validFrom: isoDateSchema });

function ApproveDialog({ person, timezone }: { person: Pending; timezone?: string }) {
  const approve = useMutation(api.residents.approve);
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof approveSchema>>({
    resolver: zodResolver(approveSchema),
    defaultValues: { roomNumber: person.roomNumber, validFrom: todayIn(timezone) },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await approve({ residentId: person.residentId, ...values });
      toast.success(`${person.displayName} is approved.`);
      setOpen(false);
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Icon icon={Check} />
          Approve
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Approve ${person.displayName}`}
        description="Check the room number and the date they start eating at the PG."
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          <Field id={`room-${person.residentId}`} label="Room number" error={errors.roomNumber?.message}>
            {(p) => <Input {...p} {...form.register("roomNumber")} />}
          </Field>
          <Field id={`from-${person.residentId}`} label="Start date" error={errors.validFrom?.message}>
            {(p) => <Input {...p} type="date" {...form.register("validFrom")} />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={isSubmitting}>
              Approve
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ person }: { person: Pending }) {
  const reject = useMutation(api.residents.reject);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={X} />
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Reject ${person.displayName}?`}
        description="They'll be told their sign-up wasn't approved. This is recorded in the audit log."
      >
        {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setServerError(null);
              try {
                await reject({ residentId: person.residentId });
                toast.success(`${person.displayName}'s sign-up was rejected.`);
                setOpen(false);
              } catch (error) {
                setServerError(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
