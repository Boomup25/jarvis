import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isOwner, currentPeriod } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Who has an account, and what they've spent this month. Owner only. */
export async function GET() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  if (!isOwner(auth.user)) return Response.json({ error: "Not allowed" }, { status: 403 });

  const period = currentPeriod();

  const [users, usage] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.usageRecord.groupBy({
      by: ["userId", "kind"],
      where: { period },
      _count: true,
    }),
  ]);

  const byUser = new Map<string, Record<string, number>>();
  for (const row of usage) {
    const entry = byUser.get(row.userId) ?? {};
    entry[row.kind] = row._count;
    byUser.set(row.userId, entry);
  }

  return Response.json({
    period,
    users: users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      monthlyQuota: user.monthlyQuota,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
      usage: byUser.get(user.id) ?? {},
    })),
  });
}

/** Change someone's quota, or switch them off. */
export async function PATCH(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  if (!isOwner(auth.user)) return Response.json({ error: "Not allowed" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Locking yourself out of your own app is a bad afternoon.
  if (id === auth.user.id && body.active === false) {
    return Response.json({ error: "You can't deactivate yourself." }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(body.monthlyQuota !== undefined
        ? { monthlyQuota: Math.max(0, Math.min(100_000, Number(body.monthlyQuota) || 0)) }
        : {}),
      ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
    },
  });

  return Response.json({ user: { id: user.id, monthlyQuota: user.monthlyQuota, active: user.active } });
}

/** Remove an account and everything it owns. Cascades handle the rest. */
export async function DELETE(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  if (!isOwner(auth.user)) return Response.json({ error: "Not allowed" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  if (id === auth.user.id) return Response.json({ error: "You can't delete yourself." }, { status: 400 });

  await prisma.user.delete({ where: { id } }).catch(() => null);
  return Response.json({ ok: true });
}
