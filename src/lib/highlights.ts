/**
 * The week, told back to you as things you actually did.
 *
 * Deliberately not another dashboard. The brief already answers "where do I
 * stand"; this answers "was the week any good", which means leading with
 * finished work rather than open counts, and always carrying the items behind
 * a number so a stat can be read as evidence instead of a score.
 */

import { getProfile, prisma } from "./db";
import { addCalendarDays, formatCalendarKey, localDateKey, localDateTimeToUtc, startOfLocalWeekKey } from "./localTime";

const DAY = 86_400_000;

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
  const profile = await getProfile(userId);
  const timeZone = profile.timezone || "America/Chicago";
  const todayKey = localDateKey(now, timeZone);
  const weekStartKey = startOfLocalWeekKey(todayKey, 1);
  const weekEndKey = addCalendarDays(weekStartKey, 7);
  const prevStartKey = addCalendarDays(weekStartKey, -7);
  const prevStart = localDateTimeToUtc(prevStartKey, timeZone, 0);

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
      if (!d) return false;
      const key = localDateKey(d, timeZone);
      return key >= weekStartKey && key < weekEndKey;
    });
  const lastWeek = <T>(items: T[], when: (t: T) => Date | null) =>
    items.filter((t) => {
      const d = when(t);
      if (!d) return false;
      const key = localDateKey(d, timeZone);
      return key >= prevStartKey && key < weekStartKey;
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
    const dayKey = addCalendarDays(weekStartKey, i);
    const inDay = (d: Date) => localDateKey(d, timeZone) === dayKey;
    days.push({
      label: DAY_LABELS[i],
      workouts: wWorkouts.filter((l) => inDay(l.occurredAt)).length,
      other: thisWeek(logs, (l) => l.occurredAt).filter(
        (l) => l.kind !== "workout" && inDay(l.occurredAt)
      ).length,
      future: dayKey > todayKey,
      today: dayKey === todayKey,
    });
  }

  // ---- streak ---------------------------------------------------------
  const workoutDays = new Set(workouts.map((l) => localDateKey(l.occurredAt, timeZone)));
  let streakDays = 0;
  for (let i = 0; i < 60; i++) {
    if (workoutDays.has(addCalendarDays(todayKey, -i))) streakDays++;
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

  const lastDayKey = todayKey < weekEndKey ? todayKey : addCalendarDays(weekEndKey, -1);
  const dayOfWeek = Math.min(7, Math.max(1, Math.round((Date.parse(`${todayKey}T12:00:00Z`) - Date.parse(`${weekStartKey}T12:00:00Z`)) / DAY) + 1));

  const total = wTasks.length + wWorkouts.length + wPages.length + wMemories.length;

  return {
    weekStart: localDateTimeToUtc(weekStartKey, timeZone, 0).toISOString(),
    weekEnd: localDateTimeToUtc(weekEndKey, timeZone, 0).toISOString(),
    rangeLabel: `${formatCalendarKey(weekStartKey, timeZone, { month: "short", day: "numeric" })} – ${formatCalendarKey(lastDayKey, timeZone, { month: "short", day: "numeric" })}`,
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
