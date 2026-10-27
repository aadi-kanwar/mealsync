"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { api } from "@convex/_generated/api";
import { Banner } from "@/components/ui/banner";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  if (convex === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
        <Banner tone="danger" title="Dine isn't connected to its database">
          The NEXT_PUBLIC_CONVEX_URL setting is missing. See README.md, “Connect Convex”.
        </Banner>
      </main>
    );
  }
  return (
    <ConvexAuthNextjsProvider client={convex}>
      <EndRevokedSession />
      {children}
    </ConvexAuthNextjsProvider>
  );
}

/**
 * If this device still holds a login but the server no longer accepts it
 * (e.g. the password was reset on another device), sign out cleanly so the
 * person lands on the sign-in page.
 */
function EndRevokedSession() {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const revoked = isAuthenticated && me === null;
  const latest = useRef(revoked);
  useEffect(() => {
    latest.current = revoked;
    if (!revoked) return;
    // Wait a moment so a stale answer from just before signing in can't sign anyone out.
    const timer = setTimeout(() => {
      if (latest.current) void signOut().finally(() => router.replace("/signin"));
    }, 1500);
    return () => clearTimeout(timer);
  }, [revoked, signOut, router]);
  return null;
}
