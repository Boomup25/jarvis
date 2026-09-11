/**
 * The single gate every bridge route goes through.
 *
 * Written so a route physically cannot forget a check: you need the user
 * object to do anything, and the only way to get it is to pass all three
 * conditions — signed in, owner, and bridge unlocked within the window.
 *
 * Members never reach the bridge at all. Sharing JARVIS with a friend was
 * never meant to share the computer it runs beside.
 */

import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { currentUser } from "./session";
import { BRIDGE_COOKIE, isOwnerUser, readUnlockToken, unlockRemaining } from "./bridge";

type Denied = { denied: Response };
type Allowed = { user: User; remainingMs: number };

const json = (body: unknown, status: number) => Response.json(body, { status });

/**
 * Requires an owner session AND a live bridge unlock.
 *
 * The 401/403/423 split is deliberate: the client needs to tell "sign in
 * again" from "you're not allowed" from "enter the passphrase".
 */
export async function requireUnlockedBridge(): Promise<Allowed | Denied> {
  const user = await currentUser();
  if (!user) return { denied: json({ error: "Not authenticated" }, 401) };

  if (!isOwnerUser(user)) {
    return { denied: json({ error: "The bridge belongs to the account owner." }, 403) };
  }

  if (!user.bridgeHash) {
    return { denied: json({ error: "No bridge passphrase set.", needsSetup: true }, 423) };
  }

  const jar = await cookies();
  const token = jar.get(BRIDGE_COOKIE)?.value;
  const unlockedFor = await readUnlockToken(token);

  // The unlock is bound to the account that created it, so it can't survive a
  // sign-out and sign-in as somebody else on the same browser.
  if (!unlockedFor || unlockedFor !== user.id) {
    return { denied: json({ error: "The bridge is locked.", locked: true }, 423) };
  }

  return { user, remainingMs: await unlockRemaining(token) };
}

/** Owner session only — for setting the passphrase and reading lock state. */
export async function requireBridgeOwner(): Promise<{ user: User } | Denied> {
  const user = await currentUser();
  if (!user) return { denied: json({ error: "Not authenticated" }, 401) };
  if (!isOwnerUser(user)) {
    return { denied: json({ error: "The bridge belongs to the account owner." }, 403) };
  }
  return { user };
}
