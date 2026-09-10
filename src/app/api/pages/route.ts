import { prisma } from "@/lib/db";
import { guard } from "@/lib/session";
import { normalizeType, uniqueSlug, findSimilarPages } from "@/lib/pages";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const type = url.searchParams.get("type");

  if (q) {
    const matches = await findSimilarPages(q, { type: type ?? undefined, limit: 30 });
    return Response.json({ pages: matches.map((m) => m.page) });
  }

  const pages = await prisma.page.findMany({
    where: { archived: false, ...(type ? { type: normalizeType(type) } : {}) },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return Response.json({ pages });
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body?.title || !body?.contentMd) {
    return Response.json({ error: "title and contentMd required" }, { status: 400 });
  }

  const slug = await uniqueSlug(String(body.title), body.slug);
  const page = await prisma.page.create({
    data: {
      slug,
      title: String(body.title),
      contentMd: String(body.contentMd),
      summary: String(body.summary ?? ""),
      type: normalizeType(body.type),
      tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 8) : [],
    },
  });
  return Response.json({ page }, { status: 201 });
}
