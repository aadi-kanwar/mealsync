"use client";

import { ArrowRight, CircleCheck, Clock, Leaf } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Brand, Eyebrow } from "@/components/app/brand";
import { destinationFor, useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";

/** Signed out: a short introduction and the two ways in. Signed in: straight to the right screen. */
export default function Home() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me) router.replace(destinationFor(me));
  }, [me, router]);
  if (me === null) return <Landing />;
  return (
    <main className="flex min-h-dvh items-center justify-center text-foreground-secondary">
      <Spinner label="Loading Dine" />
    </main>
  );
}

const STEPS = [
  { icon: Clock, text: "Open Dine before 6 AM on the day." },
  { icon: CircleCheck, text: "Tap Yes or No for each meal. It takes a few seconds." },
  { icon: Leaf, text: "The kitchen cooks for the people who'll actually eat." },
];

function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-7 px-4 py-8">
      <Brand size="lg" />
      <div className="flex flex-col gap-3">
        <Eyebrow>Before you skip a meal</Eyebrow>
        <h1 className="font-serif text-3xl tracking-tight">
          Every meal you skip is still <em className="text-primary-soft">cooked for you.</em>
        </h1>
        <p className="text-foreground-secondary">
          Unless you tell us. Food that isn&apos;t eaten can&apos;t be served the next day, so it ends up in the bin.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild width="full">
          <Link href="/signin">
            Sign in or create account
            <Icon icon={ArrowRight} />
          </Link>
        </Button>
        <Button asChild variant="ghost" width="full">
          <Link href="/signin?as=admin">PG admin? Sign in here</Link>
        </Button>
      </div>
      <section className="flex flex-col gap-2 rounded-md bg-primary p-5 text-primary-foreground">
        <p className="font-serif text-2xl italic">Food cooked today can&apos;t be served tomorrow.</p>
        <p className="text-sm opacity-90">
          So every answer counts. Tell us which meals you&apos;ll eat, and we cook just enough. No one goes hungry,
          and nothing good ends up in the bin.
        </p>
      </section>
      <section aria-labelledby="how" className="flex flex-col gap-3">
        <Eyebrow>
          <span id="how">How it works</span>
        </Eyebrow>
        <ol className="flex flex-col gap-3">
          {STEPS.map((step) => (
            <li key={step.text} className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
                <Icon icon={step.icon} className="size-4" />
              </span>
              <span className="pt-1">{step.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
