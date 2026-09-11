/**
 * The morning briefing. Deterministic facts assembled here; JARVIS only writes
 * the two-sentence greeting on top, so the dashboard still works when the
 * model is rate-limited.
 */

import { prisma, getProfile } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { completeJson } from "@/lib/openrouter";
import { utilityModel } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const userId = auth.user.id;

  const skipGreeting = new URL(req.url).searchParams.get("quick") === "1";
  const profile = await getProfile(userId);
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [openTasks, dueToday, recentPages, weekLogs, memoryCount, pageCount] = await Promise.all([
    prisma.task.findMany({ where: { userId, done: false }, orderBy: [{ dueAt: "asc" }], take: 10 }),
    prisma.task.count({
      where: { userId, done: false, dueAt: { lte: new Date(startOfDay.getTime() + 86_400_000) } },
    }),
    prisma.page.findMany({
      where: { userId, archived: false },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { slug: true, title: true, type: true, updatedAt: true },
    }),
    prisma.logEntry.findMany({ where: { userId, occurredAt: { gte: weekAgo } }, orderBy: { occurredAt: "desc" } }),
    prisma.memory.count({ where: { userId, active: true } }),
    prisma.page.count({ where: { userId, archived: false } }),
  ]);

  const workoutsThisWeek = weekLogs.filter((l) => l.kind === "workout").length;
  const lastWorkout = weekLogs.find((l) => l.kind === "workout") ?? null;

  const stats = {
    openTasks: openTasks.length,
    dueToday,
    workoutsThisWeek,
    memoryCount,
    pageCount,
    lastWorkout: lastWorkout
      ? { when: lastWorkout.occurredAt.toISOString(), page: lastWorkout.pageSlug, note: lastWorkout.note }
      : null,
  };

  let greeting: string | null = null;
  if (!skipGreeting && process.env.OPENROUTER_API_KEY) {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: profile.timezone }).format(now)
    );
    const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

    const result = await completeJson<{ greeting: string }>({
      messages: [
        {
          role: "system",
          content: `You are ${profile.assistantName}, ${profile.displayName}'s assistant — dry, composed, JARVIS from Iron Man. Return {"greeting": "..."} with two short sentences: a greeting appropriate to the time of day, and one specific observation or nudge drawn from the data. No emoji, no exclamation marks, no bullet points.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            partOfDay,
            date: now.toDateString(),
            openTasks: openTasks.map((t) => t.title),
            workoutsThisWeek,
            lastWorkoutDaysAgo: lastWorkout
              ? Math.round((Date.now() - lastWorkout.occurredAt.getTime()) / 86_400_000)
              : null,
            recentPages: recentPages.map((p) => p.title),
          }),
        },
      ],
      model: utilityModel(),
      maxTokens: 160,
    });
    greeting = result?.greeting ?? null;
  }

  return Response.json({
    greeting,
    assistantName: profile.assistantName,
    displayName: profile.displayName,
    date: now.toISOString(),
    stats,
    tasks: openTasks,
    recentPages,
  });
}
