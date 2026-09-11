import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const userId = auth.user.id;

  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    // findFirst with userId, never findUnique by id alone — otherwise a
    // guessed conversation id reads someone else's chat history.
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ conversation });
  }

  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return Response.json({ conversations });
}

export async function DELETE(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // deleteMany, so ownership is part of the query rather than a check we could
  // forget to write.
  const removed = await prisma.conversation.deleteMany({ where: { id, userId: auth.user.id } });
  if (removed.count === 0) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ ok: true });
}
