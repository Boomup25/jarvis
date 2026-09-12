import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { BOOTSTRAP_HASH, hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { clientKey, clearLimit, rateLimit, tooMany } from "@/lib/ratelimit";
import { logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;

  const key = clientKey(req, `password-change:${auth.user.id}`);
  const limit = rateLimit(key, { limit: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 });
  if (!limit.ok) {
    await logEvent("auth", "Password change rate limit hit", { level: "warn", detail: { userId: auth.user.id } });
    return tooMany(limit, "Too many attempts. Try again shortly.");
  }

  const body = await req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  const problem = passwordProblem(newPassword);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  if (currentPassword === newPassword) {
    return Response.json({ error: "Your new password must be different." }, { status: 400 });
  }

  const currentValid =
    auth.user.passwordHash === BOOTSTRAP_HASH
      ? Boolean(process.env.APP_PASSWORD) && currentPassword === process.env.APP_PASSWORD
      : await verifyPassword(currentPassword, auth.user.passwordHash);
  if (!currentValid) return Response.json({ error: "Your current password is incorrect." }, { status: 403 });

  await prisma.user.update({
    where: { id: auth.user.id },
    data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
  });
  clearLimit(key);
  return Response.json({ ok: true });
}
