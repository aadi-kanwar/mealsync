"use client";

import { useMutation, useQuery } from "convex/react";
import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";

type Support = "checking" | "unsupported" | "needs-home-screen" | "supported";

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function detectSupport(): Support {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "supported";
  return isIos() && !isStandalone() ? "needs-home-screen" : "unsupported";
}
const noSubscription = () => () => {};

/** This browser's reminder state, and turning reminders on or off. */
export function usePhoneReminders() {
  const detected = useSyncExternalStore(noSubscription, detectSupport, (): Support => "checking");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const support: Support = failed ? "unsupported" : detected;
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const key = useQuery(api.notifications.publicKey, {});
  const subscribed = useQuery(api.notifications.isSubscribed, endpoint === null ? "skip" : { endpoint });
  const subscribe = useMutation(api.notifications.subscribe);
  const unsubscribe = useMutation(api.notifications.unsubscribe);

  useEffect(() => {
    if (detected !== "supported") return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        setPermission(Notification.permission);
        return reg.pushManager.getSubscription();
      })
      .then((sub) => {
        setEndpoint(sub?.endpoint ?? null);
        setReady(true);
      })
      .catch(() => setFailed(true));
  }, [detected]);

  const turnOn = useCallback(async () => {
    if (!key?.publicKey) {
      toast.error("Reminders aren't set up on the server yet.");
      return;
    }
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.publicKey) }));
      const json = sub.toJSON();
      await subscribe({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" });
      setEndpoint(sub.endpoint);
      toast.success("Reminders are on for this phone.");
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }, [key, subscribe]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub !== null) {
        await unsubscribe({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEndpoint(null);
      toast.success("Reminders are off for this phone.");
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }, [unsubscribe]);

  const on = support === "supported" && permission === "granted" && subscribed === true;
  return { support, permission, on, loading: support === "supported" && (!ready || (endpoint !== null && subscribed === undefined)), busy, turnOn, turnOff };
}

/** Profile card: turn phone reminders on or off for this device. */
export function PhoneRemindersCard() {
  const r = usePhoneReminders();
  if (r.support === "checking" || r.loading) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Icon icon={r.on ? Bell : BellOff} className="mt-0.5 text-foreground-secondary" />
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="font-medium">Phone reminders</h2>
          <p className="text-sm text-foreground-secondary">
            {r.support === "needs-home-screen"
              ? "On iPhone, first add Dine to your Home Screen: tap Share, then “Add to Home Screen”. Open Dine from there and turn reminders on."
              : r.support === "unsupported"
                ? "This browser can't show reminders. Try Chrome on Android, or Dine added to the Home Screen on iPhone."
                : r.permission === "denied"
                  ? "Notifications are blocked for Dine. Allow them in your browser or phone settings, then come back."
                  : r.on
                    ? "On. We'll remind you if you haven't chosen your meals before the deadline."
                    : "Get a reminder on this phone if you haven't chosen your meals before the deadline."}
          </p>
        </div>
      </div>
      {r.support === "supported" && r.permission !== "denied" ? (
        r.on ? (
          <Button variant="secondary" onClick={r.turnOff} disabled={r.busy}>
            Turn off reminders
          </Button>
        ) : (
          <Button onClick={r.turnOn} disabled={r.busy}>
            <Icon icon={Bell} />
            Turn on reminders
          </Button>
        )
      ) : null}
    </Card>
  );
}

/** Home: a one-line offer to turn reminders on, shown until they're on or refused. */
export function PhoneRemindersNudge() {
  const r = usePhoneReminders();
  if (r.support !== "supported" || r.loading || r.on || r.permission !== "default") return null;
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm">
      <Icon icon={Bell} className="text-foreground-secondary" />
      <p className="flex-1">Want a reminder on this phone before the deadline?</p>
      <Button variant="secondary" onClick={r.turnOn} disabled={r.busy}>
        Turn on
      </Button>
    </div>
  );
}
