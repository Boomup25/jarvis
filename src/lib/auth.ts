/**
 * Single-user auth. One password in APP_PASSWORD, one HMAC-signed cookie.
 * Uses Web Crypto only, so the exact same code runs in middleware (edge)
 * and in route handlers (node).
 */

export const SESSION_COOKIE = "jarvis_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload));
  return b64url(sig);
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short. Set it in .env");
  }
  return s;
}

/** Constant-time-ish string compare. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return safeEqual(input, expected);
}

export async function createSessionToken(): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify({ sub: "owner", iat: Date.now() })));
  const sig = await sign(payload, secret());
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  let expected: string;
  try {
    expected = await sign(payload, secret());
  } catch {
    return false;
  }
  if (!safeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof data.iat !== "number") return false;
    if (Date.now() - data.iat > MAX_AGE_SECONDS * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
