import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { createInvite, isOwner } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Owner only — members can't mint accounts. */
export async function GET() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  if (!isOwner(auth.user)) return Response.json({ error: "Not allowed" }, { status: 403 });

  const invites = await prisma.inviteCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const now = new Date();
  return Response.json({
    invites: invites.map((invite) => ({
      id: invite.id,
      code: invite.code,
      note: invite.note,
      usedByUsername: invite.usedByUsername,
      usedAt: invite.usedAt,
      expiresAt: invite.expiresAt,
      status: invite.usedAt
        ? "used"
        : invite.expiresAt && invite.expiresAt < now
          ? "expired"
          : "open",
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  if (!isOwner(auth.user)) return Response.json({ error: "Not allowed" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const invite = await createInvite(
    auth.user.id,
    String(body.note ?? ""),
    Math.min(90, Math.max(1, Number(body.expiresInDays) || 14))
  );

  return Response.json({ invite }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  if (!isOwner(auth.user)) return Response.json({ error: "Not allowed" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Only unused invites can be revoked — deleting a used one would orphan the
  // record of who joined with it.
  await prisma.inviteCode.deleteMany({ where: { id, usedAt: null } });
  return Response.json({ ok: true });
}
