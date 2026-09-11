import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { normalizeType } from "@/lib/pages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Params) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const { slug } = await params;

  const page = await prisma.page.findUnique({
    where: { userId_slug: { userId: auth.user.id, slug } },
  });
  if (!page) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ page });
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));

  const page = await prisma.page.update({
    where: { userId_slug: { userId: auth.user.id, slug } },
    data: {
      ...(body.title !== undefined ? { title: String(body.title).slice(0, 200) } : {}),
      ...(body.summary !== undefined ? { summary: String(body.summary).slice(0, 500) } : {}),
      ...(body.contentMd !== undefined ? { contentMd: String(body.contentMd).slice(0, 60_000) } : {}),
      ...(body.type !== undefined ? { type: normalizeType(body.type) } : {}),
      ...(body.pinned !== undefined ? { pinned: Boolean(body.pinned) } : {}),
      ...(body.archived !== undefined ? { archived: Boolean(body.archived) } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags.map(String).slice(0, 8) } : {}),
    },
  });
  return Response.json({ page });
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const { slug } = await params;
  await prisma.page
    .delete({ where: { userId_slug: { userId: auth.user.id, slug } } })
    .catch(() => null);
  return Response.json({ ok: true });
}
