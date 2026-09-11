import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authenticateAgent, settle } from "@/lib/bridgeHub";

export const dynamic = "force-dynamic";

/** Results can carry a screenshot or a file excerpt, so this isn't tiny. */
const MAX_RESULT_BYTES = 4_000_000;

/**
 * The upward half of the bridge: the agent posts back what happened.
 *
 * Authenticated by the same device token as the stream, and scoped by it — a
 * machine can only ever write to commands addressed to itself, so a leaked
 * token can't be used to forge results for someone else's computer.
 */
export async function POST(req: Request) {
  const device = await authenticateAgent(req);
  if (!device) return Response.json({ error: "Unknown or revoked device." }, { status: 401 });

  const raw = await req.text();
  if (raw.length > MAX_RESULT_BYTES) {
    return Response.json({ error: "Result too large." }, { status: 413 });
  }

  let body: { id?: string; ok?: boolean; result?: unknown; error?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Malformed result." }, { status: 400 });
  }

  const id = String(body.id ?? "");
  if (!id) return Response.json({ error: "Missing command id." }, { status: 400 });

  const status = body.ok ? "ok" : body.error === "denied" ? "denied" : "error";

  /*
   * Audio never reaches the database.
   *
   * The waiter downstream gets the full payload, but the audit row keeps only
   * the metadata — there is no reason to store a copy of every sentence JARVIS
   * has ever spoken, and a few hundred KB of base64 per utterance would bloat
   * the log into uselessness within a day.
   */
  const full = body.result as Record<string, unknown> | null | undefined;
  let stored: unknown = full ?? null;
  if (full && typeof full === "object" && typeof full.audio === "string") {
    const { audio, ...rest } = full;
    stored = { ...rest, audioBytes: Buffer.byteLength(audio, "base64") };
  }

  // updateMany with both ids in the where clause: the device can only touch
  // its own commands, and that constraint is part of the query rather than a
  // check somebody could forget.
  const { count } = await prisma.deviceCommand.updateMany({
    where: { id, deviceId: device.id, userId: device.userId },
    data: {
      status,
      result: stored as Prisma.InputJsonValue,
      error: String(body.error ?? "").slice(0, 500),
      finishedAt: new Date(),
    },
  });

  if (!count) return Response.json({ error: "No such command." }, { status: 404 });

  // Wake anything waiting on this command — a chat tool call, usually.
  settle(id, { ok: Boolean(body.ok), result: body.result, error: String(body.error ?? "") });

  await prisma.device.updateMany({
    where: { id: device.id, userId: device.userId },
    data: { lastSeenAt: new Date() },
  });

  return Response.json({ ok: true });
}
