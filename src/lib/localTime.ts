/** Calendar helpers that keep activity dates in the user's profile timezone. */

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsFor(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function localDateKey(date: Date, timeZone: string): string {
  const p = partsFor(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Convert a local calendar date/time into the corresponding UTC instant. */
export function localDateTimeToUtc(dateKey: string, timeZone: string, hour = 12): Date {
  const target = Date.parse(`${dateKey}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = partsFor(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - seen;
  }
  return new Date(guess);
}

export function startOfLocalDay(date: Date, timeZone: string): Date {
  return localDateTimeToUtc(localDateKey(date, timeZone), timeZone, 0);
}

export function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function startOfLocalWeekKey(dateKey: string, weekStartsOn: 0 | 1 = 1): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  const day = date.getUTCDay();
  const offset = weekStartsOn === 1 ? (day + 6) % 7 : day;
  return addCalendarDays(dateKey, -offset);
}

export function calendarDaysBetween(laterKey: string, earlierKey: string): number {
  const later = Date.parse(`${laterKey}T12:00:00.000Z`);
  const earlier = Date.parse(`${earlierKey}T12:00:00.000Z`);
  return Math.round((later - earlier) / 86_400_000);
}

export function formatCalendarKey(dateKey: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(
    new Date(`${dateKey}T12:00:00.000Z`)
  );
}
