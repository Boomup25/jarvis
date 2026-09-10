import { prisma } from "@/lib/db";
import { guard } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const memory = await prisma.memory.update({
    where: { id },
    data: {
      ...(body.content !== undefined ? { content: String(body.content) } : {}),
      ...(body.category !== undefined ? { category: String(body.category) } : {}),
      ...(body.importance !== undefined ? { importance: Number(body.importance) } : {}),
      ...(body.pinned !== undefined ? { pinned: Boolean(body.pinned) } : {}),
    },
  });
  return Response.json({ memory });
}

export async function DELETE(_req: Request, { params }: Params) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await params;
  await prisma.memory.delete({ where: { id } }).catch(() => null);
  return Response.json({ ok: true });
}
