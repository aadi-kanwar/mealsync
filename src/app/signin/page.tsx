"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm, useWatch, type FieldErrors, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { api } from "@convex/_generated/api";
import {
  displayNameSchema,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  placeNameSchema,
  roomNumberSchema,
} from "@convex/lib/inputRules";
import { Brand } from "@/components/app/brand";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PasswordInput } from "@/components/ui/password-input";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Mode = "signIn" | "signUp";

function toE164(country: CountryCode, input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** "resident": residents and wardens; "admin": PG owners, whose sign-up creates their organisation. */
type Kind = "resident" | "admin";

function buildSchema(mode: Mode, kind: Kind) {
  return z
    .object({
      country: z.string(),
      phone: z.string().trim().min(1, "Enter your mobile number."),
      password: z.string().min(1, "Enter your password."),
      confirm: z.string(),
      displayName: z.string(),
      roomNumber: z.string(),
      organizationId: z.string(),
      propertyId: z.string(),
      organizationName: z.string(),
      propertyName: z.string(),
    })
    .superRefine((values, ctx) => {
      if (mode === "signUp") {
        const rules =
          kind === "admin"
            ? ([
                ["displayName", displayNameSchema],
                ["organizationName", placeNameSchema],
                ["propertyName", placeNameSchema],
              ] as const)
            : ([
                ["displayName", displayNameSchema],
                ["roomNumber", roomNumberSchema],
              ] as const);
        for (const [path, schema] of rules) {
          const result = schema.safeParse(values[path]);
          if (!result.success) ctx.addIssue({ code: "custom", path: [path], message: result.error.issues[0].message });
        }
        if (kind === "resident" && values.organizationId === "") {
          ctx.addIssue({ code: "custom", path: ["organizationId"], message: "Choose your organisation." });
        }
        if (kind === "resident" && values.propertyId === "") {
          ctx.addIssue({ code: "custom", path: ["propertyId"], message: "Choose your PG." });
        }
      }
      const e164 = toE164(values.country as CountryCode, values.phone);
      if (e164 === null) {
        ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid mobile number." });
      }
      if (mode === "signUp") {
        const problem = passwordProblem(values.password, e164);
        if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
        if (values.confirm !== values.password) {
          ctx.addIssue({ code: "custom", path: ["confirm"], message: "The two passwords don't match." });
        }
      }
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

// A fixed list (not the browser's built-in country names, which differ between
// the server and the phone). India first; nearby and common countries after.
const COUNTRY_NAMES: Array<[CountryCode, string]> = [
  ["IN", "India"],
  ["NP", "Nepal"],
  ["BD", "Bangladesh"],
  ["BT", "Bhutan"],
  ["LK", "Sri Lanka"],
  ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia"],
  ["QA", "Qatar"],
  ["OM", "Oman"],
  ["KW", "Kuwait"],
  ["BH", "Bahrain"],
  ["SG", "Singapore"],
  ["MY", "Malaysia"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
  ["CA", "Canada"],
  ["AU", "Australia"],
];
const COUNTRY_OPTIONS = COUNTRY_NAMES.map(([code, name]) => ({
  code,
  label: `${name} (+${getCountryCallingCode(code)})`,
}));

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  // ?as=admin: the PG owners' way in, from the landing page. Signing up
  // there creates an organisation with its first PG.
  const admin = useSearchParams().get("as") === "admin";
  const [mode, setMode] = useState<Mode>("signIn");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" aria-label="Dine home" className="self-start">
        <Brand size="lg" />
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl tracking-tight">{admin ? "Admin sign in" : "Welcome to Dine"}</h1>
        <p className="text-foreground-secondary">
          {admin ? "For PG owners and managers." : "Tell the PG which meals you'll eat."}
        </p>
      </div>
      <AuthTabs mode={mode} setMode={setMode} kind={admin ? "admin" : "resident"} />
    </main>
  );
}

function AuthTabs({ mode, setMode, kind }: { mode: Mode; setMode: (mode: Mode) => void; kind: Kind }) {
  return (
    <>
      <div role="tablist" aria-label="Sign in or create account" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
        {(
          [
            ["signIn", "Sign in"],
            ["signUp", kind === "admin" ? "Create organisation" : "Create account"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={mode === value}
            aria-controls="auth-form"
            onClick={() => setMode(value)}
            className={cn(
              "min-h-11 rounded-sm text-sm font-medium transition-colors",
              mode === value ? "bg-surface text-foreground shadow-sm" : "text-foreground-secondary hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Re-mount the form when switching so errors from one mode don't linger. */}
      <AuthForm key={mode} mode={mode} kind={kind} />
    </>
  );
}

function AuthForm({ mode, kind }: { mode: Mode; kind: Kind }) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(buildSchema(mode, kind)),
    defaultValues: {
      country: "IN",
      phone: "",
      password: "",
      confirm: "",
      displayName: "",
      roomNumber: "",
      organizationId: "",
      propertyId: "",
      organizationName: "",
      propertyName: "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const phone = toE164(values.country as CountryCode, values.phone)!;
    try {
      await signIn(
        "phone-password",
        mode === "signIn"
          ? { flow: mode, phone, password: values.password }
          : kind === "admin"
            ? {
                flow: mode,
                account: "organization",
                phone,
                password: values.password,
                displayName: values.displayName.trim(),
                organizationName: values.organizationName.trim(),
                propertyName: values.propertyName.trim(),
              }
            : {
                flow: mode,
                phone,
                password: values.password,
                displayName: values.displayName.trim(),
                roomNumber: values.roomNumber.trim(),
                propertyId: values.propertyId,
              },
      );
      router.replace("/");
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });

  return (
    <Card id="auth-form" role="tabpanel">
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          {mode === "signUp" && kind === "admin" ? (
            <>
              <Field id="displayName" label="Your full name" error={errors.displayName?.message}>
                {(p) => <Input {...p} {...form.register("displayName")} autoComplete="name" />}
              </Field>
              <Field
                id="organizationName"
                label="Organisation name"
                hint="Your business. You can add more PGs to it later, in Settings."
                error={errors.organizationName?.message}
              >
                {(p) => <Input {...p} {...form.register("organizationName")} autoComplete="organization" maxLength={80} />}
              </Field>
              <Field id="propertyName" label="Your first PG's name" error={errors.propertyName?.message}>
                {(p) => <Input {...p} {...form.register("propertyName")} autoComplete="off" maxLength={80} placeholder="e.g. Sunrise PG, Koramangala" />}
              </Field>
            </>
          ) : null}
          {mode === "signUp" && kind === "resident" ? (
            <>
              <PlacePicker form={form} errors={errors} />
              <Field id="displayName" label="Full name" error={errors.displayName?.message}>
                {(p) => <Input {...p} {...form.register("displayName")} autoComplete="name" />}
              </Field>
              <Field
                id="roomNumber"
                label="Room number"
                hint="You'll only be asked this once. The Warden will check it."
                error={errors.roomNumber?.message}
              >
                {(p) => <Input {...p} {...form.register("roomNumber")} autoComplete="off" placeholder="e.g. 204" />}
              </Field>
            </>
          ) : null}
          <Field id="country" label="Country">
            {(p) => (
              <NativeSelect {...p} {...form.register("country")} autoComplete="tel-country-code">
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="phone" label="Mobile number" error={errors.phone?.message}>
            {(p) => (
              <Input
                {...p}
                {...form.register("phone")}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
              />
            )}
          </Field>
          <Field
            id="password"
            label="Password"
            error={errors.password?.message}
            hint={mode === "signUp" ? `At least ${PASSWORD_MIN_LENGTH} characters. Not your phone number.` : undefined}
          >
            {(p) => (
              <PasswordInput
                {...p}
                {...form.register("password")}
                autoComplete={mode === "signUp" ? "new-password" : "current-password"}
              />
            )}
          </Field>
          {mode === "signUp" ? (
            <Field id="confirm" label="Type the password again" error={errors.confirm?.message}>
              {(p) => <PasswordInput {...p} {...form.register("confirm")} autoComplete="new-password" />}
            </Field>
          ) : null}
          <Button type="submit" width="full" loading={isSubmitting}>
            {mode === "signIn" ? "Sign in" : kind === "admin" ? "Create organisation" : "Create account"}
          </Button>
          <p className="text-sm text-foreground-secondary">
            {kind === "admin"
              ? mode === "signIn"
                ? "Forgot your password? Ask another Admin of your organisation to help."
                : "You'll be the Admin of your organisation. Add Wardens and more PGs from inside Dine."
              : mode === "signIn"
                ? "Forgot your password? Contact the PG office."
                : "After you sign up, the Warden checks your details before you can choose meals."}
          </p>
        </form>
      </CardBody>
    </Card>
  );
}

/** Organisation, then PG: dropdowns of the PGs using Dine. */
function PlacePicker({ form, errors }: { form: UseFormReturn<FormValues>; errors: FieldErrors<FormValues> }) {
  const directory = useQuery(api.directory.list, {});
  const organizationId = useWatch({ control: form.control, name: "organizationId" });
  const organization = directory?.find((o) => o.organizationId === organizationId);
  return (
    <>
      <Field id="organizationId" label="Organisation" error={errors.organizationId?.message}>
        {(p) => (
          <NativeSelect
            {...p}
            {...form.register("organizationId", {
              onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
                const chosen = directory?.find((o) => o.organizationId === event.target.value);
                // One PG: choose it straight away.
                form.setValue("propertyId", chosen?.properties.length === 1 ? chosen.properties[0].propertyId : "");
              },
            })}
            disabled={directory === undefined}
          >
            <option value="">{directory === undefined ? "Loading…" : "Choose your organisation"}</option>
            {directory?.map((o) => (
              <option key={o.organizationId} value={o.organizationId}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field id="propertyId" label="PG" error={errors.propertyId?.message}>
        {(p) => (
          <NativeSelect {...p} {...form.register("propertyId")} disabled={organization === undefined}>
            <option value="">{organization ? "Choose your PG" : "Choose the organisation first"}</option>
            {organization?.properties.map((pg) => (
              <option key={pg.propertyId} value={pg.propertyId}>
                {pg.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
    </>
  );
}
