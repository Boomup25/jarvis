import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireBridgeOwner } from "@/lib/bridgeGuard";
import {
  BRIDGE_COOKIE,
  UNLOCK_MINUTES,
  createUnlockToken,
  hashPassphrase,
  passphraseProblem,
  readUnlockToken,
  unlockCookieOptions,
  unlockRemaining,
  verifyPassphrase,
} from "@/lib/bridge";
import { verifyPassword } from "@/lib/password";
import { clearLimit, clientKey, rateLimit, tooMany } from "@/lib/ratelimit";
import { logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Lock state, for deciding what the panel shows. Never leaks the hash. */
export async function GET() {
  const auth = await requireBridgeOwner();
  if ("denied" in auth) return auth.denied;

  const jar = await cookies();
  const token = jar.get(BRIDGE_COOKIE)?.value;
  const unlockedFor = await readUnlockToken(token);
  const unlocked = unlockedFor === auth.user.id;

  return Response.json({
    configured: Boolean(auth.user.bridgeHash),
    unlocked,
    remainingMs: unlocked ? await unlockRemaining(token) : 0,
    unlockMinutes: UNLOCK_MINUTES,
  });
}

/**
 * Unlock, or set the passphrase for the first time / change it.
 *
 * Setting a passphrase requires the account password as well, so someone who
 * walks up to an unlocked browser can't simply assign themselves one.
 */
export async function POST(req: Request) {
  const auth = await requireBridgeOwner();
  if ("denied" in auth) return auth.denied;
  const { user } = auth;

  const body = await req.json().catch(() => ({}));
  const action = body.action === "set" ? "set" : "unlock";

  /*
   * Only a FAILED guess costs budget.
   *
   * Counting every call meant a typo'd-then-corrected passphrase, or a couple
   * of "that's too short" validation errors, could lock you out of your own
   * bridge — and it let a successful unlock bring you closer to a lockout,
   * which is nonsense. Guesses accumulate; proving who you are resets it.
   */
  const limitKey = clientKey(req, `bridge-unlock:${user.id}`);
  const spend = () =>
    rateLimit(limitKey, { limit: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 });

  if (action === "set") {
    const accountPassword = String(body.accountPassword ?? "");
    const passphrase = String(body.passphrase ?? "");

    const limit = spend();
    if (!limit.ok) {
      void logEvent("bridge", "Bridge unlock rate limit hit", { level: "warn", notify: true });
      return tooMany(limit, "Too many attempts. The bridge is locked for a while.");
    }

    // Proving you know the account password is what stops a hijacked session
    // from arming the bridge behind your back.
    if (!(await verifyPassword(accountPassword, user.passwordHash))) {
      return Response.json({ error: "That account password is wrong." }, { status: 403 });
    }
    clearLimit(limitKey); // identity proven — the budget resets

    const problem = passphraseProblem(passphrase);
    if (problem) return Response.json({ error: problem }, { status: 400 });

    if (accountPassword === passphrase) {
      return Response.json(
        { error: "Use a different passphrase from your account password." },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { bridgeHash: await hashPassphrase(passphrase) },
    });

    // Changing the passphrase invalidates every paired machine: their stored
    // tokens were encrypted with the old one and can no longer be decrypted.
    const { count } = await prisma.device.updateMany({
      where: { userId: user.id, active: true },
      data: { active: false },
    });

    void logEvent("bridge", "Bridge passphrase set", { level: "warn", notify: true });

    const jar = await cookies();
    jar.set(BRIDGE_COOKIE, await createUnlockToken(user.id), unlockCookieOptions);

    return Response.json({
      ok: true,
      unlocked: true,
      devicesRevoked: count,
      unlockMinutes: UNLOCK_MINUTES,
    });
  }

  // ---- plain unlock ----
  if (!user.bridgeHash) {
    return Response.json({ error: "No bridge passphrase set.", needsSetup: true }, { status: 423 });
  }

  const limit = spend();
  if (!limit.ok) {
    void logEvent("bridge", "Bridge unlock rate limit hit", { level: "warn", notify: true });
    return tooMany(limit, "Too many attempts. The bridge is locked for a while.");
  }

  const passphrase = String(body.passphrase ?? "");
  if (!(await verifyPassphrase(passphrase, user.bridgeHash))) {
    void logEvent("bridge", "Failed bridge unlock", { level: "warn", notify: true });
    return Response.json({ error: "That passphrase is wrong." }, { status: 403 });
  }
  clearLimit(limitKey);

  const jar = await cookies();
  jar.set(BRIDGE_COOKIE, await createUnlockToken(user.id), unlockCookieOptions);

  return Response.json({ ok: true, unlocked: true, unlockMinutes: UNLOCK_MINUTES });
}

/** Lock it again, immediately. */
export async function DELETE() {
  const auth = await requireBridgeOwner();
  if ("denied" in auth) return auth.denied;

  const jar = await cookies();
  jar.set(BRIDGE_COOKIE, "", { ...unlockCookieOptions, maxAge: 0 });
  return Response.json({ ok: true, unlocked: false });
}
