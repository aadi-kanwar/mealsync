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
import { LoadingState } from "@/components/ui/skeleton";
import { friendlyError } from "@/lib/errors";

type Values = z.infer<typeof profileSchema>;

export default function OnboardingPage() {
  const me = useMe();
  const router = useRouter();
  const completeProfile = useMutation(api.users.completeProfile);
  const [serverError, setServerError] = useState<string | null>(null);
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
    try {
      await completeProfile(values);
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
    <ResidentShell pgName={me.property?.name}>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Welcome! Tell us who you are</h1>
        <p className="text-foreground-secondary">The Warden will use this to approve your account.</p>
      </div>
      {me.property === null ? (
        <Banner tone="warning" title="MealSync isn't set up yet">
          The PG office hasn&apos;t finished setting up MealSync. Please try again later.
        </Banner>
      ) : (
        <Card>
          <CardBody>
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
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
