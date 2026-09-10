import { prisma } from "@/lib/db";
import { guard } from "@/lib/session";
import { rememberFact } from "@/lib/memory";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const memories = await prisma.memory.findMany({
    where: { active: true },
    orderBy: [{ pinned: "desc" }, { importance: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
  return Response.json({ memories });
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const memory = await rememberFact({
    content: String(body.content ?? ""),
    category: body.category,
    importance: Number(body.importance) || 3,
    source: "manual",
  });
  if (!memory) return Response.json({ error: "content too short" }, { status: 400 });
  return Response.json({ memory }, { status: 201 });
}
