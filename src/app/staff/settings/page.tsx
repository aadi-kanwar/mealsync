"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { RequireStaff } from "@/components/app/staff-gate";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, inputClasses } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

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
      {data === undefined ? (
        <LoadingState rows={2} />
      ) : (
        <>
          <SettingsForm initial={data} />
          <ResidentMessagesForm initial={data} />
        </>
      )}
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

/** The question of the day (three, taking turns) and the message about food waste. */
function ResidentMessagesForm({ initial }: { initial: { questions: string[]; wasteMessage: string } }) {
  const update = useMutation(api.settings.updateResidentMessages);
  const start = [0, 1, 2].map((i) => initial.questions[i] ?? "");
  const [questions, setQuestions] = useState(start);
  const [wasteMessage, setWasteMessage] = useState(initial.wasteMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = questions.some((q, i) => q !== start[i]) || wasteMessage !== initial.wasteMessage;
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
              await update({ questions, wasteMessage });
              toast.success("Saved. Residents see it straight away.");
            } catch (saveError) {
              setError(friendlyError(saveError));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">What residents see above their meals</h2>
            <p className="text-sm text-foreground-secondary">
              One question each day, taking turns: question 1, then 2, then 3, then 1 again.
            </p>
          </div>
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
          <Field
            id="waste-message"
            label="Message about food waste"
            hint="Shown under the meals every day. Up to 600 characters."
          >
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
  );
}
