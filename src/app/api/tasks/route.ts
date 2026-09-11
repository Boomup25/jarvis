import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const includeDone = new URL(req.url).searchParams.get("all") === "1";
  const tasks = await prisma.task.findMany({
    where: includeDone ? { userId: auth.user.id } : { userId: auth.user.id, done: false },
    orderBy: [{ done: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return Response.json({ tasks });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  if (!title) return Response.json({ error: "title required" }, { status: 400 });
  const dueAt = body.dueAt ? new Date(String(body.dueAt)) : null;
  const task = await prisma.task.create({
    data: {
      userId: auth.user.id,
      title,
      notes: String(body.notes ?? ""),
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
      pageSlug: body.pageSlug ? String(body.pageSlug) : null,
    },
  });
  return Response.json({ task }, { status: 201 });
}
