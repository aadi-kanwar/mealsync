"use node";

import { v } from "convex/values";
import webpush from "web-push";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./lib/functions";

/**
 * Sends one notification to each device (Web Push, signed with the VAPID
 * keys on the Convex deployment). Devices that no longer exist are removed.
 */
export const send = internalAction({
  args: {
    devices: v.array(
      v.object({ subscriptionId: v.id("pushSubscriptions"), endpoint: v.string(), p256dh: v.string(), auth: v.string() }),
    ),
    title: v.string(),
    body: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      console.error("Reminders not sent: VAPID keys are missing on this deployment.");
      return { delivered: 0, removed: 0 };
    }
    webpush.setVapidDetails(process.env.SITE_URL ?? "https://dine.livoza.org", publicKey, privateKey);
    const payload = JSON.stringify({ title: args.title, body: args.body, url: args.url });
    const gone: Id<"pushSubscriptions">[] = [];
    let delivered = 0;
    await Promise.all(
      args.devices.map(async (device) => {
        try {
          await webpush.sendNotification(
            { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
            payload,
            { TTL: 60 * 60 },
          );
          delivered += 1;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(device.subscriptionId);
          else console.error("Reminder failed for one device", status ?? error);
        }
      }),
    );
    if (gone.length > 0) await ctx.runMutation(internal.notifications.removeSubscriptions, { ids: gone });
    return { delivered, removed: gone.length };
  },
});
