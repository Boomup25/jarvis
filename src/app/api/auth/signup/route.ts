import { cookies } from "next/headers";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { redeemInvite } from "@/lib/users";
import { passwordProblem, usernameProblem } from "@/lib/password";
import { rateLimit, clientKey, tooMany } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Invite-only. No code, no account. */
export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req, "signup"), {
    limit: 5,
    windowMs: 60 * 60_000,
    lockoutMs: 60 * 60_000,
  });
  if (!limit.ok) return tooMany(limit, "Too many attempts. Try again later.");

  const body = await req.json().catch(() => ({}));
  const problem =
    usernameProblem(String(body.username ?? "")) ?? passwordProblem(String(body.password ?? ""));
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const { user, error } = await redeemInvite(
    String(body.code ?? ""),
    String(body.username ?? ""),
    String(body.displayName ?? ""),
    String(body.password ?? "")
  );
  if (error || !user) return Response.json({ error: error ?? "Signup failed" }, { status: 400 });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions);
  return Response.json({ ok: true, user: { username: user.username, displayName: user.displayName } });
}
