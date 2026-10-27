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
import { useForm } from "react-hook-form";
import { z } from "zod";
import { displayNameSchema, PASSWORD_MIN_LENGTH, passwordProblem, roomNumberSchema } from "@convex/lib/inputRules";
import { Brand } from "@/components/app/brand";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PasswordInput } from "@/components/ui/password-input";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Mode = "signIn" | "signUp";

function toE164(country: CountryCode, input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

function buildSchema(mode: Mode) {
  return z
    .object({
      country: z.string(),
      phone: z.string().trim().min(1, "Enter your mobile number."),
      password: z.string().min(1, "Enter your password."),
      confirm: z.string(),
      displayName: z.string(),
      roomNumber: z.string(),
    })
    .superRefine((values, ctx) => {
      if (mode === "signUp") {
        for (const [path, schema] of [
          ["displayName", displayNameSchema],
          ["roomNumber", roomNumberSchema],
        ] as const) {
          const result = schema.safeParse(values[path]);
          if (!result.success) ctx.addIssue({ code: "custom", path: [path], message: result.error.issues[0].message });
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
  // ?as=admin: the admins' way in, from the landing page. Sign in only:
  // admin accounts are never created from a public form.
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
      {admin ? (
        <AuthForm mode="signIn" admin />
      ) : (
        <ResidentTabs mode={mode} setMode={setMode} />
      )}
    </main>
  );
}

function ResidentTabs({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return (
    <>
      <div role="tablist" aria-label="Sign in or create account" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
        {(
          [
            ["signIn", "Sign in"],
            ["signUp", "Create account"],
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
      <AuthForm key={mode} mode={mode} />
    </>
  );
}

function AuthForm({ mode, admin = false }: { mode: Mode; admin?: boolean }) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: { country: "IN", phone: "", password: "", confirm: "", displayName: "", roomNumber: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const phone = toE164(values.country as CountryCode, values.phone)!;
    try {
      await signIn(
        "phone-password",
        mode === "signUp"
          ? {
              flow: mode,
              phone,
              password: values.password,
              displayName: values.displayName.trim(),
              roomNumber: values.roomNumber.trim(),
            }
          : { flow: mode, phone, password: values.password },
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
          {mode === "signUp" ? (
            <>
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
            {mode === "signIn" ? "Sign in" : "Create account"}
          </Button>
          <p className="text-sm text-foreground-secondary">
            {admin
              ? "Admin accounts are set up for you; there's no sign-up here. Forgot your password? Ask another Admin of your PG to help."
              : mode === "signIn"
              ? "Forgot your password? Contact the PG office."
              : "After you sign up, the Warden checks your details before you can choose meals."}
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
