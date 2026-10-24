"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatPhoneForDisplay, phoneSchema } from "@convex/lib/inputRules";
import { STAFF_ROLES, type StaffRole } from "@convex/lib/validators";
import { RequireStaff } from "@/components/app/staff-gate";
import { useMe } from "@/components/app/session";
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
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";

const ROLE_LABEL: Record<StaffRole, string> = { admin: "Admin", warden: "Warden", kitchen: "Kitchen" };
const ROLE_HELP: Record<StaffRole, string> = {
  admin: "Everything, including settings and staff.",
  warden: "Approves sign-ups, manages residents and corrections.",
  kitchen: "Meal counts, cooking targets and actuals. Can't see phone numbers.",
};

export default function TeamPage() {
  return (
    <RequireStaff roles={["admin"]}>
      <Team />
    </RequireStaff>
  );
}

function Team() {
  const me = useMe();
  const staff = useQuery(api.staff.list);
  return (
    <>
      <PageHeader title="Staff" description="Who can use the staff screens, and what they can do." />
      <GrantRoleForm />
      {staff === undefined ? (
        <LoadingState />
      ) : staff.length === 0 ? (
        <EmptyState icon={Users} title="No staff yet" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Phone</TH>
              <TH>Since</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {staff.map((row) => (
              <TR key={row.staffRoleId}>
                <TD className="font-medium">
                  {row.displayName}
                  {row.isMe ? <span className="text-foreground-muted"> (you)</span> : null}
                </TD>
                <TD>
                  <StatusBadge tone={row.role === "admin" ? "primary" : "neutral"} icon={ShieldCheck}>
                    {ROLE_LABEL[row.role]}
                  </StatusBadge>
                </TD>
                <TD className="tabular whitespace-nowrap">
                  {row.phone ? formatPhoneForDisplay(row.phone) : "—"}
                </TD>
                <TD className="whitespace-nowrap">{formatDateTime(row.grantedAt, me?.property?.timezone)}</TD>
                <TD className="text-right">
                  <RevokeDialog
                    staffRoleId={row.staffRoleId}
                    name={row.displayName}
                    role={row.role}
                    isMe={row.isMe}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

const grantSchema = z.object({
  phone: phoneSchema,
  role: z.enum(STAFF_ROLES),
});

function GrantRoleForm() {
  const grantRole = useMutation(api.staff.grantRole);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof grantSchema>>({
    resolver: zodResolver(grantSchema),
    defaultValues: { phone: "", role: "warden" },
  });
  const { errors, isSubmitting } = form.formState;
  const role = useWatch({ control: form.control, name: "role" });
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await grantRole(values);
      toast.success(`${ROLE_LABEL[values.role]} role given.`);
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
              They must first create an account in MealSync with their phone number.
            </p>
          </div>
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-start">
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
            <Button type="submit" loading={isSubmitting} className="sm:mt-6.5">
              <Icon icon={UserPlus} />
              Give role
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function RevokeDialog({
  staffRoleId,
  name,
  role,
  isMe,
}: {
  staffRoleId: Id<"staffRoles">;
  name: string;
  role: StaffRole;
  isMe: boolean;
}) {
  const revokeRole = useMutation(api.staff.revokeRole);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">Remove</Button>
      </DialogTrigger>
      <DialogContent
        title={`Remove ${ROLE_LABEL[role]} role from ${name}?`}
        description={
          isMe
            ? "This is your own role. You'll lose access to these screens straight away."
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
                await revokeRole({ staffRoleId });
                toast.success("Role removed.");
                setOpen(false);
              } catch (error) {
                setServerError(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
