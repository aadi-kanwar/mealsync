"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@convex/lib/inputRules";
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
    })
    .superRefine((values, ctx) => {
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
  const [mode, setMode] = useState<Mode>("signIn");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">MealSync</h1>
        <p className="text-foreground-secondary">Tell the PG which meals you&apos;ll eat.</p>
      </div>
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
    </main>
  );
}

function AuthForm({ mode }: { mode: Mode }) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: { country: "IN", phone: "", password: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const phone = toE164(values.country as CountryCode, values.phone)!;
    try {
      await signIn("phone-password", { flow: mode, phone, password: values.password });
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
            {mode === "signIn"
              ? "Forgot your password? Contact the PG office."
              : "After you sign up, the Warden checks your details before you can choose meals."}
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
