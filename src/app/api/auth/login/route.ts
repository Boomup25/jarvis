import { cookies } from "next/headers";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { authenticate } from "@/lib/users";
import { rateLimit, clearLimit, clientKey, tooMany } from "@/lib/ratelimit";
import { logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Five tries per fifteen minutes, then a lockout. Without this, a public URL
  // with a password is just a slow brute-force target.
  const key = clientKey(req, "login");
  const limit = rateLimit(key, { limit: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 });
  if (!limit.ok) {
    await logEvent("auth", "Login rate limit hit", { level: "warn", detail: { key } });
    return tooMany(limit, "Too many attempts. Try again shortly.");
  }

  let username = "";
  let password = "";
  try {
    ({ username = "", password = "" } = await req.json());
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  // A small constant delay blunts timing analysis and slows scripted guessing.
  await new Promise((r) => setTimeout(r, 350));

  const user = await authenticate(String(username), String(password));
  if (!user) return Response.json({ error: "Incorrect username or password" }, { status: 401 });

  clearLimit(key);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions);

  return Response.json({
    ok: true,
    user: { username: user.username, displayName: user.displayName, role: user.role },
  });
}
