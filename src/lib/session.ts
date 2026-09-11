import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { User } from "@prisma/client";
import { SESSION_COOKIE, readSessionToken } from "./auth";
import { prisma } from "./db";

/**
 * The signed-in user, or null. Every scoped query starts here.
 *
 * Wrapped in React's cache() so the layout and the page it renders share one
 * lookup per request instead of hitting the session table twice. Scope is a
 * single request, so there is no cross-user bleed.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const requestHeaders = await headers();
  const cookieToken = jar.get(SESSION_COOKIE)?.value;
  const authorization = requestHeaders.get("authorization") ?? "";
  const bearerToken = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  // Native clients keep the same signed session token in the platform
  // keychain and send it as Bearer auth. Browser sessions continue to use the
  // httpOnly cookie, so this does not widen the browser attack surface.
  const userId = await readSessionToken(cookieToken || bearerToken);
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user && user.active ? user : null;
});

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
