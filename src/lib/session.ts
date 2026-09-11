import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { SESSION_COOKIE, readSessionToken } from "./auth";
import { prisma } from "./db";

/** The signed-in user, or null. Every scoped query starts here. */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const userId = await readSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user && user.active ? user : null;
}

export async function isAuthed(): Promise<boolean> {
  return (await currentUser()) !== null;
}

/**
 * Route guard. Returns the user, or a Response to return immediately.
 *
 * Written this way so a handler physically cannot forget the check — you need
 * the user object to do anything, and getting it is what enforces auth.
 */
export async function requireUser(): Promise<{ user: User } | { denied: Response }> {
  const user = await currentUser();
  if (!user) return { denied: Response.json({ error: "Not authenticated" }, { status: 401 }) };
  return { user };
}

/** Back-compat for routes that only need a yes/no. */
export async function guard(): Promise<Response | null> {
  return (await isAuthed()) ? null : Response.json({ error: "Not authenticated" }, { status: 401 });
}
