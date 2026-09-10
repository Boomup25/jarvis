import { guard } from "@/lib/session";
import { buildCandidates, runAgenda } from "@/lib/agenda";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Preview: what would fire right now, plus what has already been sent. */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const [candidates, recent] = await Promise.all([
    buildCandidates(),
    prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  return Response.json({ candidates, recent });
}

/**
 * Run the rules now.
 *
 * Callable two ways: signed in from the app (the "run now" button), or by an
 * external scheduler carrying CRON_SECRET, so the app doesn't have to rely on
 * its own in-process timer if you'd rather use Railway cron.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  const viaCron = Boolean(secret && header === `Bearer ${secret}`);

  if (!viaCron) {
    const denied = await guard();
    if (denied) return denied;
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const sent = await runAgenda(new Date(), { force });
  return Response.json({ sent, count: sent.length });
}
