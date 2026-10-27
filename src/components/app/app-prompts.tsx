"use client";

import { Bell, EllipsisVertical, Share, SquarePlus } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { usePhoneReminders } from "./reminders";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const INSTALLED_KEY = "dine-installed";
const INSTALL_LATER_KEY = "dine-install-later";
const REMINDERS_LATER_KEY = "dine-reminders-later";

function readStorage(store: () => Storage, key: string) {
  try {
    return store().getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeStorage(store: () => Storage, key: string) {
  try {
    store().setItem(key, "1");
  } catch {
    // Private mode etc.: the prompt just shows again next time.
  }
}

// Chrome/Edge offer their own "Install" dialog through this event. It can fire
// before React starts, so it is caught as soon as this file loads.
let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    writeStorage(() => localStorage, INSTALLED_KEY);
    notify();
  });
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

type Platform = "ios" | "android" | "desktop";

function platform(): Platform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(ua) ? "android" : "desktop";
}

/** Opened from the home screen icon (not in a browser tab). */
function isInstalledApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

type InstallState = { show: boolean; platform: Platform; canPrompt: boolean } | null;
let lastInstall: InstallState = null;

function installState(): InstallState {
  const next = {
    show: !isInstalledApp() && !readStorage(() => localStorage, INSTALLED_KEY),
    platform: platform(),
    canPrompt: installPrompt !== null,
  };
  // Same object while nothing changed, as useSyncExternalStore requires.
  if (lastInstall && lastInstall.show === next.show && lastInstall.platform === next.platform && lastInstall.canPrompt === next.canPrompt) {
    return lastInstall;
  }
  lastInstall = next;
  return next;
}

/**
 * Pop-ups shown after sign-in, one at a time:
 * 1. "Add Dine to your home screen", on every visit until it's opened from
 *    the home screen icon (or installed through the browser's own dialog).
 * 2. Residents only: "Turn on meal reminders", on every visit until they're
 *    on (or blocked). Where notifications are already allowed (e.g. signing
 *    in again on the same phone), reminders are turned on without asking.
 * "Not now" hides a pop-up until the next visit.
 */
export function AppPrompts({ resident }: { resident: boolean }) {
  const install = useSyncExternalStore(subscribe, installState, () => null);
  const [installLater, setInstallLater] = useState(() =>
    typeof window === "undefined" ? false : readStorage(() => sessionStorage, INSTALL_LATER_KEY),
  );
  // On a computer only the browser's own Install dialog is offered: the manual steps differ too much.
  const showInstall =
    install !== null && install.show && !installLater && (install.platform !== "desktop" || install.canPrompt);

  return showInstall ? (
    <InstallDialog
      platform={install.platform}
      canPrompt={install.canPrompt}
      onLater={() => {
        writeStorage(() => sessionStorage, INSTALL_LATER_KEY);
        setInstallLater(true);
      }}
    />
  ) : resident ? (
    <RemindersPrompt />
  ) : null;
}

function InstallDialog({ platform, canPrompt, onLater }: { platform: Platform; canPrompt: boolean; onLater: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onLater())}>
      <DialogContent
        title="Add Dine to your home screen"
        description="Open Dine in one tap, like an app, and get a reminder before the meal deadline."
      >
        {canPrompt ? null : platform === "ios" ? (
          <ol className="flex flex-col gap-3 text-sm">
            <Step n={1}>
              Tap <Icon icon={Share} className="inline size-4 align-text-bottom" /> <b>Share</b> at the bottom of Safari
              (or at the top on iPad).
            </Step>
            <Step n={2}>
              Scroll down and tap <Icon icon={SquarePlus} className="inline size-4 align-text-bottom" />{" "}
              <b>Add to Home Screen</b>, then <b>Add</b>.
            </Step>
            <Step n={3}>Open Dine from the new icon on your home screen.</Step>
          </ol>
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            <Step n={1}>
              Tap the browser menu <Icon icon={EllipsisVertical} className="inline size-4 align-text-bottom" /> (top right).
            </Step>
            <Step n={2}>
              Tap <b>Add to Home screen</b> or <b>Install app</b>, then confirm.
            </Step>
            <Step n={3}>Open Dine from the new icon on your home screen or app drawer.</Step>
          </ol>
        )}
        <p className="text-sm text-foreground-secondary">Already added? Open Dine from its icon and this won&apos;t show again.</p>
        <DialogFooter>
          <Button variant="secondary" onClick={onLater}>
            Not now
          </Button>
          {canPrompt ? (
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await installPrompt?.prompt();
                  const choice = await installPrompt?.userChoice;
                  if (choice?.outcome === "accepted") writeStorage(() => localStorage, INSTALLED_KEY);
                  // The browser allows its dialog once per event; it offers a new one later.
                  installPrompt = null;
                  notify();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon icon={SquarePlus} />
              Add to home screen
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-text">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function RemindersPrompt() {
  const r = usePhoneReminders();
  const [later, setLater] = useState(() =>
    typeof window === "undefined" ? false : readStorage(() => sessionStorage, REMINDERS_LATER_KEY),
  );
  const tried = useRef(false);
  const { loading, on, permission, turnOn } = r;

  // Allowed already but not saved for this account on this phone: turn on without asking.
  useEffect(() => {
    if (loading || on || permission !== "granted" || tried.current) return;
    tried.current = true;
    void turnOn({ quiet: true });
  }, [loading, on, permission, turnOn]);

  if (r.support !== "supported" || loading || on || permission !== "default" || later) return null;
  const close = () => {
    writeStorage(() => sessionStorage, REMINDERS_LATER_KEY);
    setLater(true);
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? null : close())}>
      <DialogContent
        title="Turn on meal reminders"
        description="We'll send a notification to this phone only when you haven't chosen your meals and the deadline is close. Nothing else."
      >
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            Not now
          </Button>
          <Button
            loading={r.busy}
            onClick={async () => {
              await turnOn();
              close();
            }}
          >
            <Icon icon={Bell} />
            Turn on
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
