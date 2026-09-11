/**
 * The live registry of connected agents.
 *
 * One Railway instance, so a module-level Map is genuinely enough — the same
 * reasoning as the rate limiter. If this ever runs on more than one instance
 * this becomes a queue the agent polls instead, and the command row in the
 * database is already the source of truth, so nothing else has to change.
 *
 * Nothing here authenticates anybody. A connection only reaches this registry
 * after its device token has been verified.
 */

import { prisma } from "./db";
import { verifyDeviceSecret, parseDeviceToken, bearer } from "./bridge";
import type { Device } from "@prisma/client";

type Send = (event: string, data: unknown) => void;

const connections = new Map<string, Send>();

export function register(deviceId: string, send: Send): () => void {
  // A second connection from the same machine replaces the first, so a
  // reconnect after a dropped network doesn't leave a ghost holding the slot.
  connections.get(deviceId)?.("closed", { reason: "replaced" });
  connections.set(deviceId, send);

  return () => {
    // Only clear the slot if it's still ours — a newer connection may have
    // taken it while this one was shutting down.
    if (connections.get(deviceId) === send) connections.delete(deviceId);
  };
}

export function isConnected(deviceId: string): boolean {
  return connections.has(deviceId);
}

/* ---- waiting for a result ------------------------------------------- */

/**
 * A tool call needs the answer, not just an acknowledgement, so callers can
 * park on a command id until the agent reports back.
 *
 * The database row is still the record; this is only a fast path so a chat
 * turn doesn't have to poll. If the wait times out the caller falls back to
 * reading the row, which is why nothing is lost when an agent is slow.
 */
export interface CommandOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const waiters = new Map<string, (outcome: CommandOutcome) => void>();

export function awaitResult(commandId: string, timeoutMs: number): Promise<CommandOutcome | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(commandId);
      resolve(null);
    }, timeoutMs);

    waiters.set(commandId, (outcome) => {
      clearTimeout(timer);
      waiters.delete(commandId);
      resolve(outcome);
    });
  });
}

/** Called when the agent posts a result, to wake whoever is waiting. */
export function settle(commandId: string, outcome: CommandOutcome): void {
  waiters.get(commandId)?.(outcome);
}

/** Pushes to a machine. Returns false when it isn't connected right now. */
export function push(deviceId: string, event: string, data: unknown): boolean {
  const send = connections.get(deviceId);
  if (!send) return false;
  try {
    send(event, data);
    return true;
  } catch {
    connections.delete(deviceId);
    return false;
  }
}

/**
 * Authenticates an agent from its Authorization header.
 *
 * Returns the device, or null. Deliberately gives the caller nothing to
 * distinguish "no such device" from "wrong secret" from "revoked".
 */
export async function authenticateAgent(req: Request): Promise<Device | null> {
  const parsed = parseDeviceToken(bearer(req));
  if (!parsed) return null;

  // audit-ok: the agent has no session, so there is no userId to scope by yet.
  // The id half of the token is only a lookup key — authority comes from the
  // secret verified on the next line, and ownership from the check below it.
  const device = await prisma.device.findUnique({ where: { id: parsed.deviceId } });
  if (!device || !device.active) return null;

  if (!(await verifyDeviceSecret(parsed.secret, device.tokenHash))) return null;

  // The machine belongs to an account; if that account is gone or disabled the
  // machine loses its authority with it.
  const owner = await prisma.user.findUnique({ where: { id: device.userId } });
  if (!owner || !owner.active || owner.role !== "owner") return null;

  return device;
}
