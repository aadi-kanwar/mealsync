"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@convex/_generated/api";
import { profileSchema } from "@convex/lib/inputRules";
import { ResidentShell } from "@/components/app/resident-shell";
import { destinationFor, useMe } from "@/components/app/session";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LoadingState } from "@/components/ui/skeleton";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

type Values = z.infer<typeof profileSchema>;

export default function OnboardingPage() {
  const me = useMe();
  const router = useRouter();
  const completeProfile = useMutation(api.users.completeProfile);
  const [serverError, setServerError] = useState<string | null>(null);
  const directory = useQuery(api.directory.list, {});
  const [organizationId, setOrganizationId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const organization = directory?.find((o) => o.organizationId === organizationId);
  const form = useForm<Values>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: "", roomNumber: "" },
  });
  const { errors, isSubmitting } = form.formState;

  // Anyone who already has a profile (or is signed out) belongs elsewhere.
  useEffect(() => {
    if (me === null || (me && me.profile !== null)) router.replace(destinationFor(me));
  }, [me, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    if (propertyId === "") {
      setServerError("Choose your organisation and PG.");
      return;
    }
    try {
      await completeProfile({ ...values, propertyId });
      router.replace("/pending");
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });

  if (me === undefined || me === null || me.profile !== null) {
    return (
      <ResidentShell>
        <LoadingState rows={2} />
      </ResidentShell>
    );
  }

  return (
    <ResidentShell>
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl tracking-tight">Welcome! Tell us who you are</h1>
        <p className="text-foreground-secondary">The Warden will use this to approve your account.</p>
      </div>
      {directory !== undefined && directory.length === 0 ? (
        <Banner tone="warning" title="Dine isn't set up yet">
          No PG has finished setting up Dine yet. Please try again later.
        </Banner>
      ) : (
        <Card>
          <CardBody>
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
              <Field id="organizationId" label="Organisation">
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={organizationId}
                    disabled={directory === undefined}
                    onChange={(e) => {
                      const chosen = directory?.find((o) => o.organizationId === e.target.value);
                      setOrganizationId(e.target.value);
                      setPropertyId(chosen?.properties.length === 1 ? chosen.properties[0].propertyId : "");
                    }}
                  >
                    <option value="">Choose your organisation</option>
                    {directory?.map((o) => (
                      <option key={o.organizationId} value={o.organizationId}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field id="propertyId" label="PG">
                {(p) => (
                  <NativeSelect {...p} value={propertyId} disabled={!organization} onChange={(e) => setPropertyId(e.target.value)}>
                    <option value="">{organization ? "Choose your PG" : "Choose the organisation first"}</option>
                    {organization?.properties.map((pg) => (
                      <option key={pg.propertyId} value={pg.propertyId}>
                        {pg.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field id="displayName" label="Full name" error={errors.displayName?.message}>
                {(p) => <Input {...p} {...form.register("displayName")} autoComplete="name" />}
              </Field>
              <Field
                id="roomNumber"
                label="Room number"
                error={errors.roomNumber?.message}
                hint="The Warden can correct this when approving you."
              >
                {(p) => <Input {...p} {...form.register("roomNumber")} autoComplete="off" />}
              </Field>
              <Button type="submit" width="full" loading={isSubmitting}>
                Continue
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </ResidentShell>
  );
}
