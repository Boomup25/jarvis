/**
 * Agent configuration and the encrypted token store.
 *
 * The device token is never written to disk in the clear. It is encrypted with
 * a key derived from your bridge passphrase, which means a copied
 * `jarvis-bridge.json` is inert on its own — that is the whole point of the
 * machine-side gate. The passphrase is asked for at startup and held only in
 * memory.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export const CONFIG_DIR = join(homedir(), ".jarvis-bridge");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * What this machine is willing to do, and where.
 *
 * This lives HERE, on your computer — not in the database and not in the web
 * app. The server can only ask for things inside these roots, so a compromised
 * web session cannot widen its own reach. Editing this file is the only way to
 * grant more.
 */
export const DEFAULT_CONFIG = {
  serverUrl: "http://localhost:3000",
  name: "My computer",
  /** Absolute paths the agent will read from and write to. Nothing else exists. */
  roots: [],
  capabilities: [
    "system.info",
    "files.list",
    "files.search",
    "files.read",
    "files.write",
    "app.open",
    "speak",
  ],
  /**
   * How this machine turns text into audio.
   *
   * Defaults to whatever the OS already has, so speech works before anything
   * is downloaded. Point `engine` at "command" to use Piper, a GPU model, or
   * anything else that writes a WAV — see the README.
   */
  speech: {
    engine: null, // null = the OS default for this platform
    voice: null,
    rate: 0,
  },
  /** Never traversed even when nested inside an allowed root. */
  denyNames: [
    ".git",
    ".ssh",
    "node_modules",
    ".env",
    "AppData",
    "Library",
    "System32",
    ".aws",
    ".config",
  ],
  maxReadBytes: 512_000,
};

/**
 * Validates a server URL before it can be saved.
 *
 * Worth being strict here: a bad value written at pair time only surfaces much
 * later as a bare "Invalid URL" from fetch, with nothing to say which value was
 * wrong or where it came from. Catching it at the prompt is the difference
 * between a re-typed line and a confusing reconnect loop.
 */
export function serverUrlProblem(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Enter a URL.";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.includes(" ")
      ? `"${raw}" isn't a URL — it looks like a command. Enter the address of your JARVIS, e.g. http://localhost:3000`
      : `"${raw}" isn't a valid URL. Include the scheme, e.g. http://localhost:3000`;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `"${raw}" must start with http:// or https://`;
  }
  if (!parsed.hostname) return `"${raw}" has no host.`;
  return null;
}

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
  } catch {
    return null;
  }
}

export function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/* ---- token encryption ------------------------------------------------ */

const KEY_LEN = 32;

function deriveKey(passphrase, salt) {
  // Same family as the server's password hashing: memory-hard, so brute
  // forcing a stolen config file is expensive rather than instant.
  return scryptSync(passphrase, salt, KEY_LEN, { N: 16384, r: 8, p: 1 });
}

/** Encrypts the device token under the bridge passphrase. */
export function sealToken(token, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const sealed = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    v: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: sealed.toString("base64"),
  };
}

/**
 * Returns the token, or null when the passphrase is wrong.
 *
 * GCM authenticates as it decrypts, so a wrong passphrase fails here rather
 * than handing back plausible-looking rubbish that would only fail later as a
 * confusing 401 from the server.
 */
export function openToken(sealed, passphrase) {
  try {
    const salt = Buffer.from(sealed.salt, "base64");
    const iv = Buffer.from(sealed.iv, "base64");
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const out = Buffer.concat([
      decipher.update(Buffer.from(sealed.data, "base64")),
      decipher.final(),
    ]);
    return out.toString("utf8");
  } catch {
    return null;
  }
}

/* ---- path safety ----------------------------------------------------- */

/**
 * Resolves a requested path and refuses anything outside the allowed roots.
 *
 * The trailing-separator comparison is the point: without it, a root of
 * `C:\Users\me\Projects` would also match `C:\Users\me\ProjectsSecret`. Symlink
 * resolution happens in the caller via realpath, because a link inside a root
 * can still point outside it.
 */
export function resolveWithinRoots(requested, roots) {
  if (typeof requested !== "string" || !requested.trim()) {
    return { ok: false, reason: "No path given." };
  }
  if (!roots.length) {
    return { ok: false, reason: "This machine has no folders configured." };
  }

  const target = resolve(requested);

  for (const root of roots) {
    const base = resolve(root);
    const withSep = base.endsWith(sep) ? base : base + sep;
    if (target === base || target.startsWith(withSep)) {
      return { ok: true, path: target, root: base };
    }
  }

  return { ok: false, reason: "That path is outside the folders this machine shares." };
}

/** True when any segment is on the deny list. */
export function isDenied(path, denyNames) {
  const lower = path.toLowerCase();
  return denyNames.some((name) => {
    const needle = sep + name.toLowerCase();
    return lower.includes(needle + sep) || lower.endsWith(needle);
  });
}

export function samePassphrase(a, b) {
  const ba = Buffer.from(a ?? "");
  const bb = Buffer.from(b ?? "");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export { dirname };
