import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { createActivity } from "@/lib/activity";

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

  const { log, deduplicated } = await createActivity({
    userId: auth.user.id,
    kind,
    pageSlug: exists?.slug ?? null,
    note: String(body.note ?? "").trim(),
    value: typeof body.value === "object" && body.value ? body.value : {},
    occurredAt: body.occurredAt,
  });
  return Response.json({ log, deduplicated }, { status: deduplicated ? 200 : 201 });
}
