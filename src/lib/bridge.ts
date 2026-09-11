/**
 * The bridge gate.
 *
 * Commanding a computer is the highest-privilege thing this app can do, so it
 * sits behind its own passphrase rather than riding on the login session. A
 * stolen or left-open browser session is enough to read your memories; it is
 * deliberately NOT enough to touch your machine.
 *
 * Two gates, one secret:
 *
 *   web      unlocking mints a separate short-lived cookie that every bridge
 *            route demands on top of an owner session
 *   machine  the agent encrypts its device token on disk with the same
 *            passphrase, so a copied token file is inert without it
 *
 * The unlock lapses on its own. Nothing here grants standing access.
 */

import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import type { User } from "@prisma/client";
import { hashPassword, verifyPassword } from "./password";

export const BRIDGE_COOKIE = "jarvis_bridge";

/** How long an unlock lasts. Short on purpose. */
export const UNLOCK_MINUTES = 30;
const UNLOCK_MS = UNLOCK_MINUTES * 60 * 1000;

const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is missing or too short.");
  // Derive a distinct key so a bridge cookie can never be replayed as a
  // session cookie, or the other way round, even though both are HMAC-signed
  // with material from the same environment variable.
  return createHash("sha256").update(`bridge:${s}`).digest("hex");
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---- the passphrase ------------------------------------------------- */

export const hashPassphrase = hashPassword;

export async function verifyPassphrase(input: string, stored: string): Promise<boolean> {
  // An account that has never armed the bridge has no hash, and must never
  // be unlockable by supplying an empty string.
  if (!stored) return false;
  return verifyPassword(input, stored);
}

export function passphraseProblem(value: string): string | null {
  if (value.length < 10) return "The bridge passphrase must be at least 10 characters.";
  if (value.length > 200) return "That passphrase is too long.";
  return null;
}

/* ---- the unlock cookie ---------------------------------------------- */

/** Mints a token that expires on its own, independent of the login session. */
export async function createUnlockToken(userId: string): Promise<string> {
  const payload = b64url(
    encoder.encode(JSON.stringify({ sub: userId, exp: Date.now() + UNLOCK_MS }))
  );
  return `${payload}.${await sign(payload)}`;
}

/** Returns the user id this unlock belongs to, or null if absent or lapsed. */
export async function readUnlockToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  let expected: string;
  try {
    expected = await sign(payload);
  } catch {
    return null;
  }
  if (!safeEqual(sig, expected)) return null;

  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof data.exp !== "number" || typeof data.sub !== "string") return null;
    if (Date.now() > data.exp) return null;
    return data.sub;
  } catch {
    return null;
  }
}

/** Milliseconds left on an unlock, or 0. For showing a countdown. */
export async function unlockRemaining(token: string | undefined | null): Promise<number> {
  if (!token) return 0;
  const [payload] = token.split(".");
  if (!(await readUnlockToken(token))) return 0;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return Math.max(0, data.exp - Date.now());
  } catch {
    return 0;
  }
}

export const unlockCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const, // stricter than the session cookie, on purpose
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: UNLOCK_MINUTES * 60,
};

/* ---- device tokens --------------------------------------------------- */

/**
 * A device token is shown once and stored only as a hash — same treatment as
 * a password, because that is exactly what it is.
 *
 * The token carries its own device id: `jbr_<id>.<secret>`. Without that the
 * server would have to scrypt-verify against every paired machine on each
 * connection, which is both slow and a denial-of-service invitation. The id
 * half is not a secret; the half after the dot is.
 */
export interface MintedToken {
  deviceId: string;
  secret: string;
  token: string;
}

export function mintDeviceToken(): MintedToken {
  const deviceId = randomBytes(12).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  return { deviceId, secret, token: `jbr_${deviceId}.${secret}` };
}

/** Splits a presented token without trusting its shape. */
export function parseDeviceToken(token: string | null): { deviceId: string; secret: string } | null {
  if (!token || !token.startsWith("jbr_")) return null;
  const body = token.slice(4);
  const dot = body.indexOf(".");
  if (dot <= 0 || dot === body.length - 1) return null;
  return { deviceId: body.slice(0, dot), secret: body.slice(dot + 1) };
}

export const hashDeviceToken = hashPassword;

export async function verifyDeviceSecret(secret: string, stored: string): Promise<boolean> {
  if (!stored || !secret) return false;
  return verifyPassword(secret, stored);
}

/** Extracts a bearer token from an Authorization header. */
export function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/* ---- capabilities ---------------------------------------------------- */

/**
 * The complete set the server will relay. An agent advertises a subset; the
 * server refuses anything outside this list even if a machine claims it.
 *
 * Arbitrary shell is deliberately absent. Adding one here is a decision to be
 * made on purpose, not something that creeps in through an agent update.
 */
export const CAPABILITIES = [
  "system.info",
  "files.list",
  "files.search",
  "files.read",
  "files.write",
  "app.open",
  "screenshot",
  "media.control",
  "speak",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value);
}

/** Human labels for the log and the panel. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  "system.info": "Read machine info",
  "files.list": "List a folder",
  "files.search": "Search files",
  "files.read": "Read a file",
  "files.write": "Write a file",
  "app.open": "Open an app or link",
  screenshot: "Take a screenshot",
  "media.control": "Control playback",
  speak: "Synthesise speech locally",
};

/** Capabilities that change something, for display and future confirmation. */
export const WRITING_CAPABILITIES: ReadonlySet<string> = new Set([
  "files.write",
  "app.open",
  "media.control",
]);

/* ---- guards ---------------------------------------------------------- */

export function isOwnerUser(user: User): boolean {
  return user.role === "owner" && user.active;
}

/** Bytes compared without leaking length through timing where it matters. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
