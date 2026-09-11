import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const KINDS = ["workout", "meal", "weight", "note"];

export async function GET(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const kind = url.searchParams.get("kind");
  const logs = await prisma.logEntry.findMany({
    where: {
      userId: auth.user.id,
      occurredAt: { gte: new Date(Date.now() - days * 86_400_000) },
      ...(kind && KINDS.includes(kind) ? { kind } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  return Response.json({ logs });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const body = await req.json().catch(() => ({}));
  const kind = KINDS.includes(body.kind) ? body.kind : "note";
  const slug = body.pageSlug ? String(body.pageSlug) : null;
  const exists = slug
    ? await prisma.page.findUnique({
        where: { userId_slug: { userId: auth.user.id, slug } },
        select: { slug: true },
      })
    : null;

  const log = await prisma.logEntry.create({
    data: {
      userId: auth.user.id,
      kind,
      pageSlug: exists?.slug ?? null,
      note: String(body.note ?? ""),
      value: typeof body.value === "object" && body.value ? body.value : {},
      ...(body.occurredAt ? { occurredAt: new Date(String(body.occurredAt)) } : {}),
    },
  });
  return Response.json({ log }, { status: 201 });
}
