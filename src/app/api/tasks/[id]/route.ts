import { prisma } from "@/lib/db";
import { guard } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const done = body.done !== undefined ? Boolean(body.done) : undefined;
  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: String(body.title) } : {}),
      ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
      ...(done !== undefined ? { done, completedAt: done ? new Date() : null } : {}),
    },
  });
  return Response.json({ task });
}

export async function DELETE(_req: Request, { params }: Params) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  await prisma.task.delete({ where: { id } }).catch(() => null);
  return Response.json({ ok: true });
}
