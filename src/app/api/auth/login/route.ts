import { cookies } from "next/headers";
import { SESSION_COOKIE, checkPassword, createSessionToken, sessionCookieOptions } from "@/lib/auth";

export async function POST(req: Request) {
  let password = "";
  try {
    ({ password } = await req.json());
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  // Small constant delay makes brute-forcing over the network tedious.
  await new Promise((r) => setTimeout(r, 400));

  if (!checkPassword(String(password ?? ""))) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  return Response.json({ ok: true });
}
