import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { rememberFact } from "@/lib/memory";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const memories = await prisma.memory.findMany({
    where: { userId: auth.user.id, active: true },
    orderBy: [{ pinned: "desc" }, { importance: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
  return Response.json({ memories });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const body = await req.json().catch(() => ({}));
  const memory = await rememberFact({
    userId: auth.user.id,
    content: String(body.content ?? ""),
    category: body.category,
    importance: Number(body.importance) || 3,
    source: "manual",
  });
  if (!memory) return Response.json({ error: "content too short" }, { status: 400 });
  return Response.json({ memory }, { status: 201 });
}
