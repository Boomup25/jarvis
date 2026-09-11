import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUnlockedBridge } from "@/lib/bridgeGuard";
import { isCapability } from "@/lib/bridge";
import { isConnected, push } from "@/lib/bridgeHub";
import { clientKey, rateLimit, tooMany } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Send one instruction to a machine.
 *
 * Every command is written down before it is sent and updated when it returns,
 * so the log is the record of what was asked — including the ones that failed
 * or were refused by the agent.
 */
export async function POST(req: Request) {
  const auth = await requireUnlockedBridge();
  if ("denied" in auth) return auth.denied;

  const limit = rateLimit(clientKey(req, `bridge-cmd:${auth.user.id}`), {
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.ok) return tooMany(limit, "Slow down.");

  const body = await req.json().catch(() => ({}));
  const capability = body.capability;

  if (!isCapability(capability)) {
    return Response.json({ error: "Unknown capability." }, { status: 400 });
  }

  const device = await prisma.device.findFirst({
    where: { id: String(body.deviceId ?? ""), userId: auth.user.id, active: true },
  });
  if (!device) return Response.json({ error: "No such machine." }, { status: 404 });

  // The machine decides what it will do. If it didn't advertise this on
  // connect, the server refuses rather than sending something that would be
  // rejected at the other end anyway.
  if (!device.capabilities.includes(capability)) {
    return Response.json(
      { error: `That machine doesn't offer "${capability}".` },
      { status: 403 }
    );
  }

  const args = (body.args ?? {}) as Prisma.InputJsonObject;

  const command = await prisma.deviceCommand.create({
    data: {
      userId: auth.user.id,
      deviceId: device.id,
      capability,
      args,
      status: isConnected(device.id) ? "sent" : "pending",
      sentAt: isConnected(device.id) ? new Date() : null,
    },
  });

  const delivered = push(device.id, "command", {
    id: command.id,
    capability,
    args,
  });

  return Response.json({
    command: { id: command.id, status: command.status },
    delivered,
    // An honest answer rather than a fake success: the row is queued and will
    // go out when the machine reconnects.
    queued: !delivered,
  });
}
