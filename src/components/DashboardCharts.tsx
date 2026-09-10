"use client";

import { useState } from "react";
import type { DayCell } from "@/lib/insights";

/* Sequential ramp — one hue, more is brighter. Index 0 is "nothing logged"
   and is deliberately near the surface. */
const RAMP = [
  "color-mix(in srgb, var(--color-edge) 55%, transparent)",
  "var(--color-viz-1)",
  "var(--color-viz-2)",
  "var(--color-viz-3)",
  "var(--color-viz-4)",
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(y, m - 1, d)
  );
}

/**
 * Ten weeks of training at a glance. Magnitude by color on a single hue —
 * the safe default for "compare low to high across a grid".
 */
export function ActivityHeatmap({ cells }: { cells: DayCell[] }) {
  const [hover, setHover] = useState<DayCell | null>(null);
  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const logged = cells.filter((c) => c.workouts > 0);

  return (
    <figure className="m-0">
      <figcaption className="flex items-baseline justify-between">
        <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-mist">Last 16 weeks</h2>
        <span className="text-[0.68rem] text-mist" aria-live="polite">
          {hover
            ? `${formatDate(hover.date)} · ${hover.workouts || "no"} session${hover.workouts === 1 ? "" : "s"}`
            : `${logged.length} training days`}
        </span>
      </figcaption>

      {/* Labels and cells share ONE grid, so day rows can't drift out of
          alignment the way two side-by-side flex columns can. */}
      <div
        className="mt-2.5 grid gap-[3px]"
        style={{
          gridTemplateRows: "repeat(7, 1fr)",
          gridTemplateColumns: "12px",
          gridAutoColumns: "1fr",
          gridAutoFlow: "column",
          height: "132px",
        }}
      >
        {DAY_LABELS.map((d, i) => (
          <span key={`label-${i}`} className="flex items-center text-[0.55rem] leading-none text-mist/70">
            {i % 2 === 1 ? d : ""}
          </span>
        ))}

        {cells.map((cell) => (
          <div
            key={cell.date}
            onMouseEnter={() => setHover(cell)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(cell)}
            onBlur={() => setHover(null)}
            tabIndex={cell.workouts ? 0 : -1}
            role="img"
            aria-label={`${formatDate(cell.date)}: ${cell.workouts} sessions`}
            className="rounded-[2px] outline-none ring-arc/60 transition-transform focus-visible:ring-2"
            style={{
              background: cell.future ? "transparent" : RAMP[cell.level],
              opacity: cell.future ? 0.25 : 1,
              transform: hover?.date === cell.date ? "scale(1.3)" : undefined,
            }}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center justify-end gap-1.5 text-[0.6rem] text-mist">
        <span>Less</span>
        {RAMP.map((c, i) => (
          <span key={i} className="size-2 rounded-[2px]" style={{ background: c }} />
        ))}
        <span>More</span>
      </div>

      {logged.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[0.65rem] text-mist hover:text-frost">
            View as table
          </summary>
          <div className="mt-1.5 max-h-40 overflow-y-auto">
            <table className="w-full text-[0.7rem]">
              <thead>
                <tr className="text-mist">
                  <th className="py-1 text-left font-normal">Date</th>
                  <th className="py-1 text-right font-normal">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {logged
                  .slice()
                  .reverse()
                  .map((c) => (
                    <tr key={c.date} className="border-t border-edge/50">
                      <td className="py-1">{formatDate(c.date)}</td>
                      <td className="py-1 text-right font-mono">{c.workouts}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}

/**
 * Weekly session count. Single series, so no legend — the caption names it.
 * The current week is the point, so it carries the bright step and the only
 * direct label; prior weeks recede to a dimmer step of the same hue.
 */
export function WeekTrend({
  series,
}: {
  series: { weekStart: string; count: number }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((s) => s.count));
  const lastIndex = series.length - 1;

  return (
    <figure className="m-0">
      <figcaption className="flex items-baseline justify-between">
        <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-mist">Sessions per week</h2>
        <span className="text-[0.68rem] text-mist" aria-live="polite">
          {hover !== null
            ? `${formatDate(series[hover].weekStart)} · ${series[hover].count}`
            : `peak ${max}`}
        </span>
      </figcaption>

      <div className="mt-6 flex h-16 items-end gap-[2px]">
        {series.map((week, i) => {
          const isCurrent = i === lastIndex;
          const heightPct = week.count === 0 ? 3 : Math.max(8, (week.count / max) * 100);
          return (
            <div
              key={week.weekStart}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="relative flex flex-1 items-end"
              style={{ height: "100%" }}
            >
              <div
                role="img"
                aria-label={`Week of ${formatDate(week.weekStart)}: ${week.count} sessions`}
                className="w-full rounded-t-[4px] transition-opacity"
                style={{
                  height: `${heightPct}%`,
                  background: isCurrent ? "var(--color-viz-4)" : "var(--color-viz-2)",
                  opacity: hover === null || hover === i ? 1 : 0.45,
                }}
              />
              {isCurrent && week.count > 0 && (
                <span className="absolute -top-[18px] left-1/2 -translate-x-1/2 font-mono text-[0.65rem] text-arc">
                  {week.count}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 flex justify-between text-[0.6rem] text-mist">
        <span>16 weeks ago</span>
        <span>This week</span>
      </p>
    </figure>
  );
}
