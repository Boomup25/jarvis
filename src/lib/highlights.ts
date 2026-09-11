/**
 * The week, told back to you as things you actually did.
 *
 * Deliberately not another dashboard. The brief already answers "where do I
 * stand"; this answers "was the week any good", which means leading with
 * finished work rather than open counts, and always carrying the items behind
 * a number so a stat can be read as evidence instead of a score.
 */

import { prisma } from "./db";

const DAY = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Monday of the week containing d. Weeks read better starting on a workday. */
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const weekday = (s.getDay() + 6) % 7; // Mon = 0
  s.setDate(s.getDate() - weekday);
  return s;
}

export interface Win {
  title: string;
  detail: string;
  /** ms timestamp, for ordering and day labels. */
  at: number;
  href?: string;
}

export interface DayBar {
  /** "Mon", "Tue", … */
  label: string;
  workouts: number;
  other: number;
  future: boolean;
  today: boolean;
}

export interface Metric {
  key: string;
  label: string;
  value: number;
  previous: number;
  /** value - previous. */
  delta: number;
}

export interface Highlights {
  weekStart: string;
  weekEnd: string;
  rangeLabel: string;
  /** Days elapsed in the week so far, 1-7. */
  dayOfWeek: number;
  streakDays: number;
  metrics: Metric[];
  days: DayBar[];
  tasksDone: Win[];
  trained: Win[];
  pagesCreated: Win[];
  learned: Win[];
  /** One line at the top. Earned, not generic. */
  headline: string;
  /** True when nothing at all happened this week. */
  empty: boolean;
}

export async function buildHighlights(userId: string): Promise<Highlights> {
  const now = new Date();
  const today = startOfDay(now);
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
  const prevStart = new Date(weekStart.getTime() - 7 * DAY);

  // Everything since the start of LAST week, so the comparison is one query.
  const [logs, tasks, pages, memories] = await Promise.all([
    prisma.logEntry.findMany({
      where: { userId, occurredAt: { gte: prevStart } },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.task.findMany({
      where: { userId, done: true, completedAt: { gte: prevStart } },
      orderBy: { completedAt: "desc" },
    }),
    prisma.page.findMany({
      where: { userId, archived: false, createdAt: { gte: prevStart } },
      orderBy: { createdAt: "desc" },
      select: { slug: true, title: true, type: true, summary: true, createdAt: true },
    }),
    prisma.memory.findMany({
      where: { userId, active: true, createdAt: { gte: prevStart } },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true, category: true, createdAt: true },
    }),
  ]);

  const thisWeek = <T>(items: T[], when: (t: T) => Date | null) =>
    items.filter((t) => {
      const d = when(t);
      return d ? d >= weekStart && d < weekEnd : false;
    });
  const lastWeek = <T>(items: T[], when: (t: T) => Date | null) =>
    items.filter((t) => {
      const d = when(t);
      return d ? d >= prevStart && d < weekStart : false;
    });

  const workouts = logs.filter((l) => l.kind === "workout");

  const wTasks = thisWeek(tasks, (t) => t.completedAt);
  const wWorkouts = thisWeek(workouts, (l) => l.occurredAt);
  const wPages = thisWeek(pages, (p) => p.createdAt);
  const wMemories = thisWeek(memories, (m) => m.createdAt);

  const metrics: Metric[] = [
    metric("trained", "Sessions", wWorkouts.length, lastWeek(workouts, (l) => l.occurredAt).length),
    metric("tasks", "Finished", wTasks.length, lastWeek(tasks, (t) => t.completedAt).length),
    metric("pages", "Saved", wPages.length, lastWeek(pages, (p) => p.createdAt).length),
    metric("learned", "Learned", wMemories.length, lastWeek(memories, (m) => m.createdAt).length),
  ];

  // ---- per-day bars ---------------------------------------------------
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days: DayBar[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart.getTime() + i * DAY);
    const next = new Date(date.getTime() + DAY);
    const inDay = (d: Date) => d >= date && d < next;
    days.push({
      label: DAY_LABELS[i],
      workouts: wWorkouts.filter((l) => inDay(l.occurredAt)).length,
      other: thisWeek(logs, (l) => l.occurredAt).filter(
        (l) => l.kind !== "workout" && inDay(l.occurredAt)
      ).length,
      future: date.getTime() > today.getTime(),
      today: date.getTime() === today.getTime(),
    });
  }

  // ---- streak ---------------------------------------------------------
  const workoutDays = new Set(workouts.map((l) => startOfDay(l.occurredAt).getTime()));
  let streakDays = 0;
  for (let i = 0; i < 60; i++) {
    const d = today.getTime() - i * DAY;
    if (workoutDays.has(d)) streakDays++;
    // Not having trained *yet* today doesn't break a streak; yesterday would.
    else if (i > 0) break;
  }

  // ---- the items behind the numbers -----------------------------------
  const tasksDone: Win[] = wTasks.map((t) => ({
    title: t.title,
    detail: t.notes ? t.notes.slice(0, 90) : "",
    at: (t.completedAt ?? t.createdAt).getTime(),
    href: t.pageSlug ? `/pages/${t.pageSlug}` : undefined,
  }));

  // A log usually points at the page it came from, and "Push Day A" tells you
  // far more than the note the tool wrote ("Completed").
  const slugs = [...new Set(wWorkouts.map((l) => l.pageSlug).filter(Boolean))] as string[];
  const linked = slugs.length
    ? await prisma.page.findMany({
        where: { userId, slug: { in: slugs } },
        select: { slug: true, title: true },
      })
    : [];
  const titleBySlug = new Map(linked.map((p) => [p.slug, p.title]));

  const trained: Win[] = wWorkouts.map((l) => {
    const fromPage = l.pageSlug ? titleBySlug.get(l.pageSlug) : undefined;
    const title = fromPage || l.note || titleFromValue(l.value) || "Session logged";
    return {
      title,
      // Don't repeat the title, and don't surface the tool's own boilerplate.
      detail: fromPage && l.note && l.note !== fromPage && l.note.length > 12 ? l.note : "",
      at: l.occurredAt.getTime(),
      href: l.pageSlug ? `/pages/${l.pageSlug}` : undefined,
    };
  });

  const pagesCreated: Win[] = wPages.map((p) => ({
    title: p.title,
    detail: p.summary || p.type,
    at: p.createdAt.getTime(),
    href: `/pages/${p.slug}`,
  }));

  const learned: Win[] = wMemories.map((m) => ({
    title: m.content,
    detail: m.category,
    at: m.createdAt.getTime(),
  }));

  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  const lastDay = new Date(Math.min(weekEnd.getTime() - DAY, today.getTime()));
  const dayOfWeek = Math.min(7, Math.floor((today.getTime() - weekStart.getTime()) / DAY) + 1);

  const total = wTasks.length + wWorkouts.length + wPages.length + wMemories.length;

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    rangeLabel: `${fmt.format(weekStart)} – ${fmt.format(lastDay)}`,
    dayOfWeek,
    streakDays,
    metrics,
    days,
    tasksDone,
    trained,
    pagesCreated,
    learned,
    headline: headlineFor({ metrics, streakDays, dayOfWeek, total }),
    empty: total === 0,
  };
}

function metric(key: string, label: string, value: number, previous: number): Metric {
  return { key, label, value, previous, delta: value - previous };
}

/** Logs carry a free-form value blob; pull something readable out of it. */
function titleFromValue(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as Record<string, unknown>;
  const name = typeof v.exercise === "string" ? v.exercise : typeof v.name === "string" ? v.name : "";
  const sets = typeof v.sets === "number" ? `${v.sets}×` : "";
  const reps = typeof v.reps === "number" ? `${v.reps}` : "";
  const weight = typeof v.weight === "number" ? ` @ ${v.weight}` : "";
  const detail = [sets + reps, weight].join("").trim();
  return [name, detail].filter(Boolean).join(" ").trim();
}

/**
 * One earned line. No praise for a week that hasn't happened yet, and no
 * "great job!" when the numbers are down — either reads as noise and stops
 * meaning anything.
 */
function headlineFor({
  metrics,
  streakDays,
  dayOfWeek,
  total,
}: {
  metrics: Metric[];
  streakDays: number;
  dayOfWeek: number;
  total: number;
}): string {
  if (total === 0) {
    return dayOfWeek <= 2
      ? "The week's just started. Nothing on the board yet."
      : "Quiet week so far. Nothing logged.";
  }

  const trained = metrics.find((m) => m.key === "trained");
  const tasks = metrics.find((m) => m.key === "tasks");

  if (streakDays >= 3) {
    return `${streakDays} days in a row. Don't break it now.`;
  }
  if (trained && trained.value > 0 && trained.delta > 0) {
    return `${trained.value} sessions — ${trained.delta} more than last week.`;
  }
  if (tasks && tasks.value >= 3) {
    return `${tasks.value} things finished and off your plate.`;
  }
  if (trained && trained.value > 0) {
    return `${trained.value} ${trained.value === 1 ? "session" : "sessions"} in the books.`;
  }
  return `${total} things logged this week.`;
}
