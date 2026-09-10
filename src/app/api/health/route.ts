import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch (err) {
    return Response.json(
      { ok: false, db: "down", error: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}
