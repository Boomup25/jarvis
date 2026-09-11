/**
 * Password hashing with scrypt from node's stdlib — no dependency, and the
 * right algorithm for this (memory-hard, so a leaked database is expensive to
 * attack offline).
 *
 * Node-only: this is imported from route handlers, never from the proxy.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const KEYLEN = 64;

/** Sentinel left by the multi-user migration; swapped on first login. */
export const BOOTSTRAP_HASH = "bootstrap";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;

  try {
    const derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), KEYLEN);
    const expected = Buffer.from(keyHex, "hex");
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Minimum bar for a new password. Deliberately modest — length beats rules. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";
  return null;
}

export function usernameProblem(username: string): string | null {
  if (!/^[a-z0-9_-]{3,24}$/i.test(username)) {
    return "Username must be 3–24 characters: letters, numbers, dashes or underscores.";
  }
  return null;
}
