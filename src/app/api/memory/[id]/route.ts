import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // updateMany, so the userId predicate is part of the query itself.
  // update({ where: { id } }) would happily edit another account's row.
  const changed = await prisma.memory.updateMany({
    where: { id, userId: auth.user.id },
    data: {
      ...(body.content !== undefined ? { content: String(body.content) } : {}),
      ...(body.category !== undefined ? { category: String(body.category) } : {}),
      ...(body.importance !== undefined ? { importance: Number(body.importance) } : {}),
      ...(body.pinned !== undefined ? { pinned: Boolean(body.pinned) } : {}),
    },
  });
  if (changed.count === 0) return Response.json({ error: "Not found" }, { status: 404 });
  const memory = await prisma.memory.findUnique({ where: { id } });
  return Response.json({ memory });
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const { id } = await params;
  await prisma.memory.deleteMany({ where: { id, userId: auth.user.id } }).catch(() => null);
  return Response.json({ ok: true });
}
