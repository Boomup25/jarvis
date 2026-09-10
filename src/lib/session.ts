import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

export async function isAuthed(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

/** Returns a 401 Response when not signed in, otherwise null. */
export async function guard(): Promise<Response | null> {
  if (await isAuthed()) return null;
  return Response.json({ error: "Not authenticated" }, { status: 401 });
}
