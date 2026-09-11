import { prisma, getProfile } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  return Response.json({
    profile: await getProfile(auth.user.id),
    account: {
      username: auth.user.username,
      displayName: auth.user.displayName,
      role: auth.user.role,
    },
  });
}

export async function PATCH(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  await getProfile(auth.user.id);
  const body = await req.json().catch(() => ({}));
  const profile = await prisma.profile.update({
    where: { userId: auth.user.id },
    data: {
      ...(body.displayName !== undefined ? { displayName: String(body.displayName) } : {}),
      ...(body.assistantName !== undefined ? { assistantName: String(body.assistantName) } : {}),
      ...(body.timezone !== undefined ? { timezone: String(body.timezone) } : {}),
      ...(body.bio !== undefined ? { bio: String(body.bio) } : {}),
      ...(body.data !== undefined && typeof body.data === "object" ? { data: body.data } : {}),
    },
  });
  return Response.json({ profile });
}
