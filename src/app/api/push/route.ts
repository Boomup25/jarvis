import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

/** What the client needs to decide whether to offer push at all. */
export async function GET() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;

  const count = await prisma.pushSubscription.count({
    where: { userId: auth.user.id, active: true },
  });
  return Response.json({
    configured: pushConfigured(),
    publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    devices: count,
  });
}

/** Register (or re-activate) this browser. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;

  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const record = await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: {
      userId: auth.user.id,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      active: true,
      failures: 0,
    },
    create: {
      userId: auth.user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      label: String(body.label ?? "").slice(0, 80),
    },
  });

  return Response.json({ ok: true, id: record.id });
}

/** Unregister this browser. */
export async function DELETE(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const body = await req.json().catch(() => ({}));
  if (!body.endpoint) return Response.json({ error: "endpoint required" }, { status: 400 });
  await prisma.pushSubscription.updateMany({
    where: { userId: auth.user.id, endpoint: String(body.endpoint) },
    data: { active: false },
  });
  return Response.json({ ok: true });
}
