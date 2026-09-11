import { createSessionToken } from "@/lib/auth";
import { authenticate } from "@/lib/users";
import { rateLimit, clearLimit, clientKey, tooMany } from "@/lib/ratelimit";
import { logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Native clients cannot rely on a browser's httpOnly cookie jar. This route
 * returns the same signed, 30-day session token used by the web app so an iOS
 * client can store it in Keychain and send `Authorization: Bearer ...` to all
 * existing authenticated APIs, including /api/speak.
 */
export async function POST(req: Request) {
  const key = clientKey(req, "mobile-login");
  const limit = rateLimit(key, { limit: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 });
  if (!limit.ok) {
    await logEvent("auth", "Mobile login rate limit hit", { level: "warn", detail: { key } });
    return tooMany(limit, "Too many attempts. Try again shortly.");
  }

  let username = "";
  let password = "";
  try {
    ({ username = "", password = "" } = await req.json());
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  const user = await authenticate(String(username), String(password));
  if (!user) return Response.json({ error: "Incorrect username or password" }, { status: 401 });

  clearLimit(key);
  const accessToken = await createSessionToken(user.id);
  return Response.json({
    ok: true,
    accessToken,
    tokenType: "Bearer",
    expiresIn: 60 * 60 * 24 * 30,
    user: { username: user.username, displayName: user.displayName, role: user.role },
  });
}
