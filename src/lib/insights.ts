/**
 * The analytics behind the dashboard.
 *
 * Everything here is deterministic — computed from the log, not written by a
 * model. The model only ever narrates these numbers, so the dashboard stays
 * correct and instant even when OpenRouter is rate-limited.
 */

import { prisma } from "./db";

const DAY = 86_400_000;
export const HEATMAP_WEEKS = 16;

export type Tone = "good" | "warn" | "alert" | "info";

export interface Insight {
  tone: Tone;
  title: string;
  detail: string;
}

export interface Recommendation {
  title: string;
  reason: string;
  /** Prefilled into the chat composer when tapped. */
  prompt: string;
}

export interface DayCell {
  /** YYYY-MM-DD in local time. */
  date: string;
  /** Total logged entries that day. */
  count: number;
  workouts: number;
  meals: number;
  /** 0-4, drives the heatmap ramp. */
  level: number;
  future: boolean;
}

export interface Insights {
  generatedAt: string;
  streakDays: number;
  daysSinceWorkout: number | null;
  thisWeek: number;
  lastWeek: number;
  weekDelta: number;
  weeklySeries: { weekStart: string; count: number }[];
  heatmap: DayCell[];
  totals: { pages: number; memories: number; tasks: number; logs: number };
  typeBalance: { type: string; count: number }[];
  topPages: { slug: string; title: string; type: string; viewCount: number }[];
  stalePages: { slug: string; title: string; daysSince: number }[];
  insights: Insight[];
  recommendations: Recommendation[];
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Sunday of the week containing d. */
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

function levelFor(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

export async function buildInsights(userId: string): Promise<Insights> {
  const now = new Date();
  const today = startOfDay(now);
  const gridStart = startOfWeek(new Date(today.getTime() - (HEATMAP_WEEKS - 1) * 7 * DAY));

  const [logs, pages, memories, openTasks, allPages] = await Promise.all([
    prisma.logEntry.findMany({
      where: { userId, occurredAt: { gte: gridStart } },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.page.count({ where: { userId, archived: false } }),
    prisma.memory.count({ where: { userId, active: true } }),
    prisma.task.count({ where: { userId, done: false } }),
    prisma.page.findMany({
      where: { userId, archived: false },
      select: { slug: true, title: true, type: true, viewCount: true, lastViewedAt: true, updatedAt: true },
      orderBy: { viewCount: "desc" },
      take: 200,
    }),
  ]);

  // ---- daily buckets -------------------------------------------------
  const byDay = new Map<string, { workouts: number; meals: number; count: number }>();
  for (const log of logs) {
    const k = key(startOfDay(log.occurredAt));
    const cell = byDay.get(k) ?? { workouts: 0, meals: 0, count: 0 };
    cell.count++;
    if (log.kind === "workout") cell.workouts++;
    if (log.kind === "meal") cell.meals++;
    byDay.set(k, cell);
  }

  const heatmap: DayCell[] = [];
  for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
    const date = new Date(gridStart.getTime() + i * DAY);
    const k = key(date);
    const cell = byDay.get(k) ?? { workouts: 0, meals: 0, count: 0 };
    heatmap.push({
      date: k,
      count: cell.count,
      workouts: cell.workouts,
      meals: cell.meals,
      level: levelFor(cell.workouts || cell.count),
      future: date.getTime() > today.getTime(),
    });
  }

  // ---- streak: consecutive days back from today with a workout -------
  // Today not yet trained doesn't break the streak — yesterday would.
  let streakDays = 0;
  for (let i = 0; i < 365; i++) {
    const date = new Date(today.getTime() - i * DAY);
    const cell = byDay.get(key(date));
    if (cell?.workouts) streakDays++;
    else if (i > 0) break;
  }

  const lastWorkout = logs.find((l) => l.kind === "workout");
  const daysSinceWorkout = lastWorkout
    ? Math.floor((today.getTime() - startOfDay(lastWorkout.occurredAt).getTime()) / DAY)
    : null;

  // ---- weekly series --------------------------------------------------
  const weekly = new Map<string, number>();
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const ws = new Date(gridStart.getTime() + w * 7 * DAY);
    weekly.set(key(ws), 0);
  }
  for (const log of logs) {
    if (log.kind !== "workout") continue;
    const ws = key(startOfWeek(log.occurredAt));
    if (weekly.has(ws)) weekly.set(ws, (weekly.get(ws) ?? 0) + 1);
  }
  const weeklySeries = [...weekly.entries()].map(([weekStart, count]) => ({ weekStart, count }));

  const thisWeekKey = key(startOfWeek(now));
  const lastWeekKey = key(startOfWeek(new Date(now.getTime() - 7 * DAY)));
  const thisWeek = weekly.get(thisWeekKey) ?? 0;
  const lastWeek = weekly.get(lastWeekKey) ?? 0;

  // ---- library -------------------------------------------------------
  const typeCounts = new Map<string, number>();
  for (const page of allPages) typeCounts.set(page.type, (typeCounts.get(page.type) ?? 0) + 1);
  const typeBalance = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const topPages = allPages
    .filter((p) => p.viewCount > 0)
    .slice(0, 4)
    .map((p) => ({ slug: p.slug, title: p.title, type: p.type, viewCount: p.viewCount }));

  const stalePages = allPages
    .map((p) => {
      const last = p.lastViewedAt ?? p.updatedAt;
      return {
        slug: p.slug,
        title: p.title,
        daysSince: Math.floor((now.getTime() - last.getTime()) / DAY),
      };
    })
    .filter((p) => p.daysSince >= 21)
    .sort((a, b) => b.daysSince - a.daysSince)
    .slice(0, 3);

  const insights = deriveInsights({
    streakDays,
    daysSinceWorkout,
    thisWeek,
    lastWeek,
    pages,
    memories,
    openTasks,
    typeBalance,
    stalePages,
  });

  const recommendations = deriveRecommendations({
    daysSinceWorkout,
    thisWeek,
    pages,
    memories,
    typeBalance,
    stalePages,
    topPages,
  });

  return {
    generatedAt: now.toISOString(),
    streakDays,
    daysSinceWorkout,
    thisWeek,
    lastWeek,
    weekDelta: thisWeek - lastWeek,
    weeklySeries,
    heatmap,
    totals: { pages, memories, tasks: openTasks, logs: logs.length },
    typeBalance,
    topPages,
    stalePages,
    insights,
    recommendations,
  };
}

interface DeriveArgs {
  streakDays: number;
  daysSinceWorkout: number | null;
  thisWeek: number;
  lastWeek: number;
  pages: number;
  memories: number;
  openTasks: number;
  typeBalance: { type: string; count: number }[];
  stalePages: { slug: string; title: string; daysSince: number }[];
}

function deriveInsights(a: DeriveArgs): Insight[] {
  const out: Insight[] = [];

  if (a.daysSinceWorkout === null) {
    out.push({
      tone: "info",
      title: "No training logged yet",
      detail: "Mark a workout complete once you've done it and I'll start tracking patterns.",
    });
  } else if (a.daysSinceWorkout === 0) {
    out.push({ tone: "good", title: "Trained today", detail: "Logged and counted." });
  } else if (a.daysSinceWorkout >= 5) {
    out.push({
      tone: "alert",
      title: `${a.daysSinceWorkout} days since your last session`,
      detail: "Long enough that the first one back should be lighter than you think.",
    });
  } else if (a.daysSinceWorkout >= 3) {
    out.push({
      tone: "warn",
      title: `${a.daysSinceWorkout} days off`,
      detail: "Still inside a normal rest window, but worth getting back to it.",
    });
  }

  if (a.streakDays >= 3) {
    out.push({
      tone: "good",
      title: `${a.streakDays}-day streak`,
      detail: "Consistency is doing more work here than any single session.",
    });
  }

  if (a.lastWeek > 0 || a.thisWeek > 0) {
    const delta = a.thisWeek - a.lastWeek;
    if (delta > 0) {
      out.push({
        tone: "good",
        title: `Up ${delta} session${delta === 1 ? "" : "s"} on last week`,
        detail: `${a.thisWeek} this week against ${a.lastWeek} last.`,
      });
    } else if (delta < 0) {
      out.push({
        tone: "warn",
        title: `Down ${Math.abs(delta)} on last week`,
        detail: `${a.thisWeek} this week against ${a.lastWeek} last. Recoverable if the week isn't over.`,
      });
    }
  }

  const workouts = a.typeBalance.find((t) => t.type === "workout")?.count ?? 0;
  const recipes = a.typeBalance.find((t) => t.type === "recipe")?.count ?? 0;
  if (workouts >= 3 && recipes === 0) {
    out.push({
      tone: "info",
      title: "Training is tracked, food isn't",
      detail: "You've got workouts saved and no meals. That's usually the half that decides results.",
    });
  }

  if (a.memories < 6) {
    out.push({
      tone: "info",
      title: "I barely know you",
      detail: `${a.memories} thing${a.memories === 1 ? "" : "s"} remembered. Everything I write is generic until that grows.`,
    });
  }

  if (a.stalePages.length) {
    out.push({
      tone: "warn",
      title: `${a.stalePages.length} page${a.stalePages.length === 1 ? "" : "s"} gathering dust`,
      detail: `"${a.stalePages[0].title}" hasn't been opened in ${a.stalePages[0].daysSince} days.`,
    });
  }

  if (a.openTasks >= 5) {
    out.push({
      tone: "warn",
      title: `${a.openTasks} open tasks`,
      detail: "The list is getting long enough to stop being useful.",
    });
  }

  return out.slice(0, 4);
}

function deriveRecommendations(a: {
  daysSinceWorkout: number | null;
  thisWeek: number;
  pages: number;
  memories: number;
  typeBalance: { type: string; count: number }[];
  stalePages: { slug: string; title: string; daysSince: number }[];
  topPages: { slug: string; title: string; type: string; viewCount: number }[];
}): Recommendation[] {
  const out: Recommendation[] = [];
  const has = (type: string) => (a.typeBalance.find((t) => t.type === type)?.count ?? 0) > 0;

  if (a.memories < 6) {
    out.push({
      title: "Tell me about yourself",
      reason: "Everything gets sharper once I know your stats, goals and equipment",
      prompt:
        "Here's my background so you can tailor things: my height and weight are, my training goal is, " +
        "the equipment I have access to is, and my dietary restrictions are ",
    });
  }

  if (a.daysSinceWorkout === null || a.daysSinceWorkout >= 2) {
    out.push({
      title: a.daysSinceWorkout === null ? "Build your first workout" : "Plan today's session",
      reason:
        a.daysSinceWorkout === null
          ? "Nothing logged yet — start with what you can actually do this week"
          : `${a.daysSinceWorkout} days since the last one`,
      prompt: "What should I train today? Take into account what I've done recently.",
    });
  }

  if (!has("recipe")) {
    out.push({
      title: "Sort out dinner",
      reason: "No meals saved yet — nutrition is the untracked half",
      prompt: "Give me a high-protein dinner I can cook tonight in under 30 minutes.",
    });
  }

  if (!has("plan") && a.pages >= 3) {
    out.push({
      title: "Turn this into a real plan",
      reason: "You have enough saved pages to structure a proper week",
      prompt: "Build me a weekly training and meal plan using the pages I already have.",
    });
  }

  if (a.stalePages.length) {
    const stale = a.stalePages[0];
    out.push({
      title: `Refresh "${stale.title}"`,
      reason: `Untouched for ${stale.daysSince} days — progress it or retire it`,
      prompt: `Review my "${stale.title}" page. Should it be updated or replaced?`,
    });
  }

  if (a.thisWeek >= 4) {
    out.push({
      title: "Schedule a lighter day",
      reason: `${a.thisWeek} sessions this week already`,
      prompt: "I've trained hard this week. Give me a mobility or active-recovery session.",
    });
  }

  return out.slice(0, 3);
}
