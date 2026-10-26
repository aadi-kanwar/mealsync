"use client";

import { ArrowRight, CalendarCheck, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { destinationFor, useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
      <Spinner label="Loading MealSync" />
    </main>
  );
}

const POINTS = [
  { icon: CalendarCheck, text: "Residents say Yes or No to each of tomorrow's meals before the cutoff." },
  { icon: Users, text: "The Warden sees an exact headcount for every meal, live." },
  { icon: ShieldCheck, text: "Less food cooked for no one, less waste." },
];

function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-8 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">MealSync</h1>
        <p className="text-lg text-foreground-secondary">Know how many will eat, before you cook.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {POINTS.map((point) => (
          <li key={point.text} className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
              <Icon icon={point.icon} className="size-4" />
            </span>
            <span className="pt-1">{point.text}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3">
        <Entry
          href="/signin"
          title="Residents and wardens"
          text="Sign in, or create an account if you're new to the PG."
          primary
        />
        <Entry href="/signin?as=admin" title="PG admins" text="Sign in to manage your PG, menus, residents and staff." />
      </div>
    </main>
  );
}

function Entry({ href, title, text, primary = false }: { href: string; title: string; text: string; primary?: boolean }) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-foreground-secondary">{text}</p>
      </div>
      <Button asChild variant={primary ? "primary" : "secondary"} size="icon" aria-label={title}>
        <Link href={href}>
          <Icon icon={ArrowRight} />
        </Link>
      </Button>
    </Card>
  );
}
