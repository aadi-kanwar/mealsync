"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { RequireStaff } from "@/components/app/staff-gate";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";

export default function SettingsPage() {
  return (
    <RequireStaff roles={[]}>
      <Settings />
    </RequireStaff>
  );
}

function Settings() {
  const data = useQuery(api.settings.get);
  return (
    <>
      <PageHeader title="Settings" description="Your organisation and PG details. Residents and staff see the PG name." />
      {data === undefined ? <LoadingState rows={2} /> : <SettingsForm initial={data} />}
    </>
  );
}

function SettingsForm({ initial }: { initial: { organizationName: string; propertyName: string } }) {
  const update = useMutation(api.settings.update);
  const [organizationName, setOrganizationName] = useState(initial.organizationName);
  const [propertyName, setPropertyName] = useState(initial.propertyName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = organizationName !== initial.organizationName || propertyName !== initial.propertyName;
  return (
    <Card className="max-w-lg">
      <CardBody>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await update({ organizationName, propertyName });
              toast.success("Details saved.");
            } catch (saveError) {
              setError(friendlyError(saveError));
            } finally {
              setBusy(false);
            }
          }}
        >
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
  );
}
