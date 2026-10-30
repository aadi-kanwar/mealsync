"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { Building2, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatPhoneForDisplay, phoneSchema } from "@convex/lib/inputRules";
import { STAFF_ROLES, type StaffRole } from "@convex/lib/validators";
import { RequireStaff } from "@/components/app/staff-gate";
import { usePropertyScope } from "@/components/app/property-scope";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useQuery } from "@/lib/convex";

const ROLE_LABEL: Record<StaffRole, string> = { admin: "Admin", warden: "Warden" };
const ROLE_HELP: Record<StaffRole, string> = {
  admin: "Everything, in every property, including staff, menus, reports and settings.",
  warden: "Approves sign-ups and sees the headcount, responses and residents of the properties you choose.",
};

type Person = FunctionReturnType<typeof api.staff.list>[number];

export default function TeamPage() {
  return (
    <RequireStaff roles={["admin"]}>
      <Team />
    </RequireStaff>
  );
}

function Team() {
  const { timezone } = usePropertyScope();
  const staff = useQuery(api.staff.list, {});
  return (
    <>
      <PageHeader
        title="Staff"
        description="Who can use the staff screens. Admins see every property; Wardens only the properties you assign them."
      />
      <GrantRoleForm />
      {staff === undefined ? (
        <LoadingState />
      ) : staff.length === 0 ? (
        <EmptyState icon={Users} title="No staff yet" />
      ) : (
        <Card>
          <ul className="divide-y divide-border" aria-label="Staff">
            {staff.map((person) => (
              <StaffRow key={person.userId} person={person} timezone={timezone} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function StaffRow({ person, timezone }: { person: Person; timezone: string }) {
  const { properties } = usePropertyScope();
  const names = person.propertyIds.flatMap((id) => properties.find((p) => p.propertyId === id)?.name ?? []);
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {person.displayName}
            {person.isMe ? <span className="text-foreground-muted"> (you)</span> : null}
          </span>
          <StatusBadge tone={person.role === "admin" ? "primary" : "neutral"} icon={ShieldCheck}>
            {ROLE_LABEL[person.role]}
          </StatusBadge>
        </div>
        <span className="text-sm text-foreground-secondary">
          {person.phone ? <span className="tabular">{formatPhoneForDisplay(person.phone)}</span> : "No phone"} · since{" "}
          {formatDateTime(person.since, timezone)}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          <Icon icon={Building2} className="size-4 text-foreground-secondary" />
          {person.role === "admin" ? (
            <span className="text-foreground-secondary">Every property</span>
          ) : names.length === 0 ? (
            <span className="text-warning">No property yet</span>
          ) : (
            names.map((name) => (
              <span key={name} className="rounded-full border border-border bg-subtle px-2 py-0.5 text-xs font-medium">
                {name}
              </span>
            ))
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {person.role === "warden" ? <PropertiesDialog person={person} /> : null}
        <RemoveDialog person={person} />
      </div>
    </li>
  );
}

/** Tick boxes for the organisation's properties. */
function PropertyChoices({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: Id<"properties">[];
  onChange: (next: Id<"properties">[]) => void;
}) {
  const { properties } = usePropertyScope();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1.5 text-sm font-medium">Properties they look after</legend>
      {properties.map((p) => {
        const checked = value.includes(p.propertyId);
        return (
          <label key={p.propertyId} htmlFor={`${idPrefix}-${p.propertyId}`} className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              id={`${idPrefix}-${p.propertyId}`}
              type="checkbox"
              className="size-5 accent-primary"
              checked={checked}
              onChange={() => onChange(checked ? value.filter((id) => id !== p.propertyId) : [...value, p.propertyId])}
            />
            <span>{p.name}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

const grantSchema = z.object({
  phone: phoneSchema,
  role: z.enum(STAFF_ROLES),
});

function GrantRoleForm() {
  const grantRole = useMutation(api.staff.grantRole);
  const { current, properties } = usePropertyScope();
  const [propertyIds, setPropertyIds] = useState<Id<"properties">[]>(() =>
    current ? [current.propertyId] : properties.length === 1 ? [properties[0].propertyId] : [],
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof grantSchema>>({
    resolver: zodResolver(grantSchema),
    defaultValues: { phone: "", role: "warden" },
  });
  const { errors, isSubmitting } = form.formState;
  const role = useWatch({ control: form.control, name: "role" });
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    if (values.role === "warden" && propertyIds.length === 0) {
      setServerError("Choose at least one property for the Warden.");
      return;
    }
    try {
      await grantRole({ ...values, propertyIds: values.role === "warden" ? propertyIds : undefined });
      toast.success(`${ROLE_LABEL[values.role]} added.`);
      form.reset({ phone: "", role: values.role });
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });
  return (
    <Card>
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-medium">Add a staff member</h2>
            <p className="text-sm text-foreground-secondary">
              They must first create an account in Dine with their phone number.
            </p>
          </div>
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
            <Field id="grant-phone" label="Their mobile number" error={errors.phone?.message}>
              {(p) => <Input {...p} type="tel" inputMode="tel" {...form.register("phone")} />}
            </Field>
            <Field id="grant-role" label="Role" hint={ROLE_HELP[role]}>
              {(p) => (
                <NativeSelect {...p} {...form.register("role")}>
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          {role === "warden" && properties.length > 1 ? (
            <PropertyChoices idPrefix="grant" value={propertyIds} onChange={setPropertyIds} />
          ) : null}
          <Button type="submit" loading={isSubmitting} className="self-start">
            <Icon icon={UserPlus} />
            Add {ROLE_LABEL[role]}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function PropertiesDialog({ person }: { person: Person }) {
  const setProperties = useMutation(api.staff.setProperties);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(person.propertyIds);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValue(person.propertyIds);
          setServerError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" aria-label={`Change ${person.displayName}'s properties`}>
          <Icon icon={Building2} />
          Properties
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`${person.displayName}'s properties`}
        description="They see the headcount, responses, residents and sign-ups of these properties only."
      >
        {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
        <PropertyChoices idPrefix={`edit-${person.userId}`} value={value} onChange={setValue} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            loading={busy}
            disabled={value.length === 0}
            onClick={async () => {
              setBusy(true);
              setServerError(null);
              try {
                await setProperties({ userId: person.userId, propertyIds: value });
                toast.success("Saved.");
                setOpen(false);
              } catch (error) {
                setServerError(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ person }: { person: Person }) {
  const remove = useMutation(api.staff.remove);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" aria-label={`Remove ${person.displayName} from staff`}>
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Remove ${person.displayName} from staff?`}
        description={
          person.isMe
            ? "This is you. You'll lose access to these screens straight away."
            : "They'll lose access to these screens straight away. This is recorded in the audit log."
        }
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
                await remove({ userId: person.userId });
                toast.success("Removed from staff.");
                setOpen(false);
              } catch (error) {
                setServerError(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
