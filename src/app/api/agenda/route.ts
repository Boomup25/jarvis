import { requireUser } from "@/lib/session";
import { buildCandidates, runAgenda, runAgendaForEveryone } from "@/lib/agenda";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Preview: what would fire right now, plus what has already been sent. */
export async function GET() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;

  const [candidates, recent] = await Promise.all([
    buildCandidates(auth.user.id),
    prisma.notification.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
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

  // Cron runs the rules for everyone; a signed-in user only ever runs their own.
  if (viaCron) {
    const count = await runAgendaForEveryone();
    return Response.json({ sent: [], count });
  }

  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;

  const force = new URL(req.url).searchParams.get("force") === "1";
  const sent = await runAgenda(auth.user.id, new Date(), { force });
  return Response.json({ sent, count: sent.length });
}
