import Link from "next/link";
import type { Insight, Recommendation, Tone } from "@/lib/insights";
import { AlertIcon, ArrowIcon, CheckIcon, InfoIcon, SparkIcon } from "./Icons";

/* Status colors are reserved and never reused as series colors — and each one
   always ships with an icon and a text label, so state is never carried by
   color alone. */
const TONE: Record<Tone, { color: string; Icon: typeof CheckIcon; label: string }> = {
  good: { color: "var(--color-jade)", Icon: CheckIcon, label: "On track" },
  warn: { color: "var(--color-gold)", Icon: AlertIcon, label: "Watch" },
  alert: { color: "var(--color-ember)", Icon: AlertIcon, label: "Needs attention" },
  info: { color: "var(--color-arc)", Icon: InfoIcon, label: "Note" },
};

export function InsightRow({ insight }: { insight: Insight }) {
  const { color, Icon, label } = TONE[insight.tone];
  return (
    <li className="flex items-start gap-3 border border-edge bg-panel/50 px-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0" style={{ color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[0.85rem] font-medium leading-snug">{insight.title}</p>
        <p className="mt-0.5 text-[0.75rem] leading-snug text-mist">{insight.detail}</p>
      </div>
      <span className="sr-only">{label}</span>
    </li>
  );
}

export function RecommendationRow({ rec }: { rec: Recommendation }) {
  return (
    <li>
      <Link
        href={`/chat?q=${encodeURIComponent(rec.prompt)}`}
        className="group flex items-center gap-3 border border-edge bg-panel/50 px-3 py-3 transition-colors hover:border-arc/40"
      >
        <SparkIcon className="size-4 shrink-0 text-arc" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.85rem] font-medium">{rec.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[0.72rem] leading-snug text-mist">{rec.reason}</p>
        </div>
        <ArrowIcon className="size-4 shrink-0 text-mist transition-transform group-hover:translate-x-0.5 group-hover:text-arc" aria-hidden />
      </Link>
    </li>
  );
}

/** Value + optional delta. A number, not a one-bar bar chart. */
export function StatTile({
  label,
  value,
  delta,
  accent = "var(--color-arc)",
  suffix,
}: {
  label: string;
  value: number | string;
  delta?: number;
  accent?: string;
  suffix?: string;
}) {
  return (
    <div className="border border-edge bg-panel/50 px-2.5 py-3">
      <p className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold leading-none" style={{ color: accent }}>
          {value}
        </span>
        {suffix && <span className="text-[0.7rem] text-mist">{suffix}</span>}
      </p>
      <p className="readout mt-1 leading-tight">{label}</p>
      {delta !== undefined && delta !== 0 && (
        <p
          className="mt-0.5 text-[0.62rem] font-medium"
          style={{ color: delta > 0 ? "var(--color-jade)" : "var(--color-gold)" }}
        >
          {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs last week
        </p>
      )}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="readout">{children}</h2>
      {action}
    </div>
  );
}
