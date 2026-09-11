/**
 * Letting JARVIS act on a connected machine.
 *
 * These tools only exist when there is actually a machine to act on. If the
 * bridge is locked, or no agent is connected, the schemas are never handed to
 * the model — which is why it correctly says it can't rather than promising
 * something and failing. An assistant that offers what it cannot do is worse
 * than one that plainly declines.
 *
 * Every call still passes through the same gate as the panel: owner account,
 * live unlock, and a capability the machine itself advertised.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { awaitResult, isConnected, push } from "./bridgeHub";
import type { Capability } from "./bridge";

/** How long a chat turn will wait for a machine before giving up on it. */
const COMMAND_TIMEOUT_MS = 20_000;

export interface BridgeContext {
  userId: string;
  deviceId: string;
  deviceName: string;
  capabilities: string[];
  roots: string[];
}

/**
 * Resolves the machine this turn may act on, or null.
 *
 * Deliberately picks the machine rather than letting the model name one: a
 * model choosing a device id is a decision it has no business making, and it
 * would be one more thing an injected instruction could steer.
 */
export async function bridgeContextFor(userId: string): Promise<BridgeContext | null> {
  const devices = await prisma.device.findMany({
    where: { userId, active: true },
    orderBy: { lastSeenAt: "desc" },
  });

  const live = devices.find((d) => isConnected(d.id));
  if (!live || live.capabilities.length === 0) return null;

  return {
    userId,
    deviceId: live.id,
    deviceName: live.name,
    capabilities: live.capabilities,
    roots: live.roots,
  };
}

export interface BridgeOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Sends one command and waits for the answer.
 *
 * Written down before it is sent and updated when it returns, so the audit log
 * shows what the assistant did on your machine — not only what you clicked.
 */
export async function runOnMachine(
  ctx: BridgeContext,
  capability: Capability,
  args: Record<string, unknown>
): Promise<BridgeOutcome> {
  if (!ctx.capabilities.includes(capability)) {
    return { ok: false, error: `${ctx.deviceName} doesn't offer that.` };
  }
  if (!isConnected(ctx.deviceId)) {
    return { ok: false, error: `${ctx.deviceName} isn't connected right now.` };
  }

  const command = await prisma.deviceCommand.create({
    data: {
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      capability,
      args: args as Prisma.InputJsonObject,
      status: "sent",
      sentAt: new Date(),
    },
  });

  const waiting = awaitResult(command.id, COMMAND_TIMEOUT_MS);
  const delivered = push(ctx.deviceId, "command", {
    id: command.id,
    capability,
    args,
  });

  if (!delivered) {
    await prisma.deviceCommand.updateMany({
      where: { id: command.id, userId: ctx.userId },
      data: { status: "error", error: "The machine disconnected before it could be sent." },
    });
    return { ok: false, error: `${ctx.deviceName} disconnected.` };
  }

  const outcome = await waiting;
  if (outcome) return outcome;

  // The waiter timed out. The row is the record, so check whether the agent
  // answered late before declaring failure.
  const row = await prisma.deviceCommand.findFirst({
    where: { id: command.id, userId: ctx.userId },
  });
  if (row && (row.status === "ok" || row.status === "error")) {
    return { ok: row.status === "ok", result: row.result, error: row.error };
  }

  await prisma.deviceCommand.updateMany({
    where: { id: command.id, userId: ctx.userId },
    data: { status: "error", error: "Timed out waiting for the machine." },
  });
  return { ok: false, error: `${ctx.deviceName} didn't answer in time.` };
}
