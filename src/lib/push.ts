/**
 * Web Push delivery.
 *
 * iOS supports this only for a PWA installed to the home screen — which is why
 * the settings UI tells you to add it there first rather than silently failing.
 */

import webpush from "web-push";
import { prisma } from "./db";

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:jarvis@localhost",
    publicKey,
    privateKey
  );
  configured = true;
  return true;
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Sends to every active subscription. Prunes the ones the browser has revoked. */
export async function sendPush(payload: PushPayload): Promise<number> {
  if (!configure()) return 0;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { active: true } });
  if (!subscriptions.length) return 0;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag ?? "jarvis",
  });

  let delivered = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
        delivered++;
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastSentAt: new Date(), failures: 0 },
        });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the browser threw the subscription away — stop trying.
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { active: false },
          });
        } else {
          await prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { failures: { increment: 1 } },
          });
        }
      }
    })
  );

  return delivered;
}
