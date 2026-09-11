import { prisma } from "@/lib/db";
import { requireUnlockedBridge } from "@/lib/bridgeGuard";
import { hashDeviceToken, mintDeviceToken } from "@/lib/bridge";
import { logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Paired machines. Token hashes never leave the server. */
export async function GET() {
  const auth = await requireUnlockedBridge();
  if ("denied" in auth) return auth.denied;

  const devices = await prisma.device.findMany({
    where: { userId: auth.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      platform: true,
      capabilities: true,
      roots: true,
      active: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });

  const now = Date.now();
  return Response.json({
    devices: devices.map((d) => ({
      ...d,
      // A machine is "online" if it has checked in recently; the SSE stream
      // heartbeats, so a stale timestamp means the agent is gone.
      online: d.active && d.lastSeenAt ? now - d.lastSeenAt.getTime() < 90_000 : false,
    })),
    remainingMs: auth.remainingMs,
  });
}

/**
 * Pair a new machine. The token is returned exactly once — from here on the
 * server only holds its hash, the same as a password.
 */
export async function POST(req: Request) {
  const auth = await requireUnlockedBridge();
  if ("denied" in auth) return auth.denied;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 60) || "My computer";

  const minted = mintDeviceToken();
  const device = await prisma.device.create({
    data: {
      // The id is supplied rather than generated so it can be carried inside
      // the token, letting the agent be looked up in one query.
      id: minted.deviceId,
      userId: auth.user.id,
      name,
      tokenHash: await hashDeviceToken(minted.secret),
    },
    select: { id: true, name: true, createdAt: true },
  });

  void logEvent("bridge", `Paired a machine: ${name}`, { level: "warn", notify: true });

  return Response.json({ device, token: minted.token });
}

/** Revoke a machine. Its next request is refused. */
export async function DELETE(req: Request) {
  const auth = await requireUnlockedBridge();
  if ("denied" in auth) return auth.denied;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  // deleteMany so the userId lands inside the query rather than being checked
  // after the fact.
  const { count } = await prisma.device.deleteMany({ where: { id, userId: auth.user.id } });
  if (count) void logEvent("bridge", "Revoked a machine", { level: "warn", notify: true });

  return Response.json({ ok: count > 0 });
}
