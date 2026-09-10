import { prisma } from "@/lib/db";
import { guard } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ conversation });
  }

  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return Response.json({ conversations });
}

export async function DELETE(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await prisma.conversation.delete({ where: { id } }).catch(() => null);
  return Response.json({ ok: true });
}
