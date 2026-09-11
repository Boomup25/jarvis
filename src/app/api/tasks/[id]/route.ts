import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const done = body.done !== undefined ? Boolean(body.done) : undefined;

  const changed = await prisma.task.updateMany({
    where: { id, userId: auth.user.id },
    data: {
      ...(body.title !== undefined ? { title: String(body.title) } : {}),
      ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
      ...(done !== undefined ? { done, completedAt: done ? new Date() : null } : {}),
    },
  });
  if (changed.count === 0) return Response.json({ error: "Not found" }, { status: 404 });
  const task = await prisma.task.findUnique({ where: { id } });
  return Response.json({ task });
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const { id } = await params;
  await prisma.task.deleteMany({ where: { id, userId: auth.user.id } }).catch(() => null);
  return Response.json({ ok: true });
}
