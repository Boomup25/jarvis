import { prisma, getProfile, PROFILE_ID } from "@/lib/db";
import { guard } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return Response.json({ profile: await getProfile() });
}

export async function PATCH(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  await getProfile();
  const body = await req.json().catch(() => ({}));
  const profile = await prisma.profile.update({
    where: { id: PROFILE_ID },
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
