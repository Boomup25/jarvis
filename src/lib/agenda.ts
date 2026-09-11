/**
 * The rules that decide what is worth interrupting you for.
 *
 * Deliberately conservative. A notification you didn't want is worse than a
 * notification you didn't get — mute it once and every future one is wasted.
 * Every rule is deduped by a per-day key, so nothing can nag twice.
 */

import { prisma, getProfile } from "./db";
import { buildInsights } from "./insights";
import { getSettings } from "./settings";
import { sendPush } from "./push";
import { getForecast, hourLabel } from "./weather";

export type NotificationKind = "brief" | "workout" | "task" | "weather" | "stale" | "system";

export interface Candidate {
  kind: NotificationKind;
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
  /** Higher wins when several rules fire at once. */
  priority: number;
}

const dayKey = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function localHour(d: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(d));
}

/** True when now falls inside the user's quiet window. */
export function inQuietHours(now: Date, tz: string, from: number, to: number): boolean {
  const hour = localHour(now, tz);
  // Windows that wrap midnight (22 → 7) need the OR form.
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

/**
 * Builds every notification that *could* fire right now. The caller filters by
 * settings, quiet hours and dedupe.
 */
export async function buildCandidates(userId: string, now = new Date()): Promise<Candidate[]> {
  const [profile, settings, insights] = await Promise.all([
    getProfile(userId),
    getSettings(userId),
    buildInsights(userId),
  ]);

  const tz = profile.timezone || "America/Chicago";
  const today = dayKey(now, tz);
  const hour = localHour(now, tz);
  const out: Candidate[] = [];

  const forecast =
    settings.lat != null && settings.lon != null
      ? await getForecast(settings.lat, settings.lon, tz)
      : null;

  // ---- morning brief -------------------------------------------------
  const briefHour = settings.briefHour ?? 7;
  if (hour === briefHour) {
    const parts: string[] = [];

    if (forecast) {
      parts.push(`${forecast.today.highF}°/${forecast.today.lowF}°, ${forecast.today.description}`);
    }
    if (insights.daysSinceWorkout === 0) parts.push("already trained today");
    else if (insights.daysSinceWorkout != null && insights.daysSinceWorkout >= 2) {
      parts.push(`${insights.daysSinceWorkout} days since training`);
    }
    if (insights.totals.tasks > 0) {
      parts.push(`${insights.totals.tasks} open task${insights.totals.tasks === 1 ? "" : "s"}`);
    }
    if (insights.thisWeek > 0) parts.push(`${insights.thisWeek} sessions this week`);

    out.push({
      kind: "brief",
      dedupeKey: `brief:${today}`,
      title: `Good morning, ${profile.displayName}.`,
      body: parts.length ? parts.join(" · ") : "Nothing pressing. Your day is clear.",
      url: "/",
      priority: 5,
    });
  }

  // ---- rain before an outdoor plan -----------------------------------
  // Only fires in the afternoon, and only for genuinely likely rain.
  if (forecast?.rain && forecast.rain.chance >= 60 && hour >= 12 && hour <= 17) {
    out.push({
      kind: "weather",
      dedupeKey: `weather:${today}`,
      title: "Weather worth knowing about",
      body: `${forecast.rain.chance}% chance of ${forecast.today.description} from about ${hourLabel(
        forecast.rain.startsHour
      )}. Worth moving anything outdoors earlier.`,
      url: "/",
      priority: 7,
    });
  }

  // ---- training nudge -------------------------------------------------
  if (insights.daysSinceWorkout != null && insights.daysSinceWorkout >= 3 && hour >= 9 && hour <= 19) {
    out.push({
      kind: "workout",
      dedupeKey: `workout:${today}`,
      title: `${insights.daysSinceWorkout} days since your last session`,
      body:
        insights.daysSinceWorkout >= 6
          ? "Long enough that the first one back should be lighter than you think. Want me to put something together?"
          : "Still inside a normal rest window, but the week is getting away from you.",
      url: "/chat?q=" + encodeURIComponent("What should I train today?"),
      priority: 6,
    });
  }

  // ---- tasks due today or overdue -------------------------------------
  const dueSoon = await prisma.task.findMany({
    where: {
      userId,
      done: false,
      dueAt: { not: null, lte: new Date(now.getTime() + 24 * 3600_000) },
    },
    orderBy: { dueAt: "asc" },
    take: 3,
  });
  if (dueSoon.length && hour >= 8 && hour <= 20) {
    out.push({
      kind: "task",
      dedupeKey: `task:${today}`,
      title: dueSoon.length === 1 ? "One task due" : `${dueSoon.length} tasks due`,
      body: dueSoon.map((t) => t.title).join(" · "),
      url: "/",
      priority: 8,
    });
  }

  return out;
}

/**
 * Runs the rules and pushes whatever survives. Returns what was sent, so the
 * cron log and the manual "run now" button can report the same thing.
 */
export async function runAgenda(
  userId: string,
  now = new Date(),
  opts?: { force?: boolean }
): Promise<Candidate[]> {
  const [profile, settings] = await Promise.all([getProfile(userId), getSettings(userId)]);
  const tz = profile.timezone || "America/Chicago";

  if (!opts?.force) {
    if (settings.pushEnabled === false) return [];
    const from = settings.quietFrom ?? 22;
    const to = settings.quietTo ?? 7;
    if (inQuietHours(now, tz, from, to)) return [];
  }

  const candidates = await buildCandidates(userId, now);
  const muted = settings.mutedKinds ?? [];
  const allowed = candidates
    .filter((c) => !muted.includes(c.kind))
    .sort((a, b) => b.priority - a.priority);

  const sent: Candidate[] = [];

  for (const candidate of allowed) {
    // The unique constraint on dedupeKey is the lock: if the row already
    // exists this throws, and we skip. No double-sends, even if the scheduler
    // fires twice.
    try {
      await prisma.notification.create({
        data: {
          userId,
          kind: candidate.kind,
          dedupeKey: opts?.force ? `${candidate.dedupeKey}:${Date.now()}` : candidate.dedupeKey,
          title: candidate.title,
          body: candidate.body,
          url: candidate.url,
        },
      });
    } catch {
      continue; // already sent in this window
    }

    const delivered = await sendPush(userId, {
      title: candidate.title,
      body: candidate.body,
      url: candidate.url,
      tag: candidate.kind,
    });

    await prisma.notification.updateMany({
      where: { userId, dedupeKey: candidate.dedupeKey },
      data: { delivered },
    });

    sent.push(candidate);

    // One interruption at a time unless it's the brief.
    if (candidate.kind !== "brief") break;
  }

  return sent;
}


/**
 * The scheduler entry point: runs the rules for every active account.
 *
 * One user's failure must not stop the rest, so each is caught individually.
 */
export async function runAgendaForEveryone(now = new Date()): Promise<number> {
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true } });
  let total = 0;

  for (const user of users) {
    try {
      const sent = await runAgenda(user.id, now);
      total += sent.length;
    } catch (err) {
      const { logEvent } = await import("./logger");
      await logEvent("agenda", `Rules failed for a user`, { detail: err });
    }
  }

  return total;
}
