import { prisma } from "@/lib/db";
import { authenticateAgent, register } from "@/lib/bridgeHub";
import { CAPABILITIES, isCapability } from "@/lib/bridge";

export const dynamic = "force-dynamic";

/** Keeps proxies from reaping an idle connection. */
const HEARTBEAT_MS = 25_000;

/**
 * The downward half of the bridge: commands travel server → agent over a
 * long-lived Server-Sent Events stream.
 *
 * SSE rather than WebSockets because the agent only ever needs to be told
 * things, results go back over ordinary POSTs, and plain HTTP survives proxies
 * and Next.js route handlers without a second server process.
 *
 * The agent dials out, so nothing on the user's machine has to be reachable
 * from the internet — no port forwarding, no firewall hole.
 */
export async function GET(req: Request) {
  const device = await authenticateAgent(req);
  if (!device) {
    return Response.json({ error: "Unknown or revoked device." }, { status: 401 });
  }

  // The agent announces what it is willing to do on connect. The server keeps
  // it for display and refuses anything outside the known set — a machine
  // cannot invent a capability by claiming one.
  const url = new URL(req.url);
  const claimed = (url.searchParams.get("capabilities") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(isCapability);
  const roots = (url.searchParams.get("roots") ?? "")
    .split("|")
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 20);
  const platform = (url.searchParams.get("platform") ?? "").slice(0, 60);

  await prisma.device.updateMany({
    where: { id: device.id, userId: device.userId },
    data: {
      capabilities: claimed.length ? claimed : [...CAPABILITIES].slice(0, 0),
      roots,
      platform,
      lastSeenAt: new Date(),
    },
  });

  const encoder = new TextEncoder();
  let unregister: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client already went away. The stream cancel handler will
          // remove the registry entry when the runtime observes it.
          return;
        }

        // A reconnect for the same device replaces the previous registry
        // entry. Close the old SSE immediately after notifying its client;
        // leaving it open creates a ghost connection that can be replaced
        // again on every later reconnect.
        if (event === "closed") {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      send("ready", { deviceId: device.id, name: device.name });

      // Anything queued while the agent was offline goes out immediately, so a
      // dropped connection doesn't silently swallow a command.
      const pending = await prisma.deviceCommand.findMany({
        where: { deviceId: device.id, userId: device.userId, status: "pending" },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      for (const command of pending) {
        send("command", {
          id: command.id,
          capability: command.capability,
          args: command.args,
        });
      }
      if (pending.length) {
        await prisma.deviceCommand.updateMany({
          where: { id: { in: pending.map((p) => p.id) }, userId: device.userId },
          data: { status: "sent", sentAt: new Date() },
        });
      }

      unregister = register(device.id, send);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
          void prisma.device
            .updateMany({
              where: { id: device.id, userId: device.userId },
              data: { lastSeenAt: new Date() },
            })
            .catch(() => {});
        } catch {
          /* the cancel handler below does the cleanup */
        }
      }, HEARTBEAT_MS);
    },

    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unregister?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Railway sits behind a proxy that will happily buffer a stream to death.
      "X-Accel-Buffering": "no",
    },
  });
}
