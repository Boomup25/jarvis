import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { buildHighlights, type Win } from "@/lib/highlights";
import { WeekDays } from "@/components/DashboardCharts";
import { CheckIcon, DumbbellIcon, BrainIcon, LibraryIcon, SparkIcon } from "@/components/Icons";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your week · JARVIS" };

export default async function WeekPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const week = await buildHighlights(user.id);

  return (
    <main className="h-full overflow-y-auto overscroll-contain px-4 pb-10 page-top lg:px-8 lg:page-top-wide">
      <div className="mx-auto w-full max-w-lg md:max-w-2xl lg:max-w-5xl">
        <Link href="/" className="readout hover:text-frost">
          ← Brief
        </Link>

        <header className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-xl font-semibold lg:text-2xl">Your week</h1>
            <span className="readout shrink-0">{week.rangeLabel}</span>
          </div>
          <p className="mt-1.5 text-[0.95rem] leading-snug text-frost lg:text-[1.05rem]">
            {week.headline}
          </p>
        </header>

        {week.streakDays >= 2 && (
          <div className="notch-tr mt-4 flex items-center gap-3 border border-gold/30 bg-gold/[0.06] px-4 py-3">
            <SparkIcon className="size-4 shrink-0 text-gold" aria-hidden />
            <p className="text-[0.85rem] text-gold">
              {week.streakDays}-day streak
              <span className="ml-2 text-mist">
                {week.streakDays >= 5 ? "This is the good part." : "Keep it going."}
              </span>
            </p>
          </div>
        )}

        {/* ---- the four numbers ---------------------------------------- */}
        <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:gap-3">
          {week.metrics.map((m) => (
            <div key={m.key} className="brackets border border-edge bg-panel/50 px-3 py-3">
              <p className="font-mono text-2xl leading-none text-frost">{m.value}</p>
              <p className="readout mt-1.5">{m.label}</p>
              {(m.value > 0 || m.previous > 0) && (
                <p
                  className={`mt-1 text-[0.65rem] ${
                    m.delta > 0 ? "text-jade" : m.delta < 0 ? "text-mist" : "text-mist"
                  }`}
                >
                  {m.delta > 0 ? `▲ ${m.delta}` : m.delta < 0 ? `▼ ${Math.abs(m.delta)}` : "—"}
                  <span className="ml-1 text-mist/70">vs last week</span>
                </p>
              )}
            </div>
          ))}
        </section>

        {/* ---- the week, day by day ------------------------------------ */}
        <section className="mt-5 glass p-4 lg:p-5">
          <WeekDays days={week.days} />
        </section>

        {week.empty ? (
          <section className="mt-6 border border-dashed border-edge px-4 py-10 text-center">
            <p className="text-[0.9rem]">Nothing on the board yet.</p>
            <p className="mx-auto mt-1.5 max-w-sm text-[0.78rem] leading-snug text-mist">
              Log a workout, finish a task, or ask JARVIS for something worth saving — it
              all lands here.
            </p>
            <Link
              href="/chat"
              className="notch-tr mt-5 inline-block border border-arc/60 bg-arc/[0.12] px-6 py-2.5 text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-arc transition-colors hover:bg-arc/20"
            >
              Talk to JARVIS
            </Link>
          </section>
        ) : (
          /* Wins first. Two columns from lg so the page doesn't become a
             single long scroll of short lists. */
          <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
            <WinList
              title="What you finished"
              icon={<CheckIcon className="size-3.5 text-jade" aria-hidden />}
              wins={week.tasksDone}
              empty="No tasks ticked off yet."
            />
            <WinList
              title="What you trained"
              icon={<DumbbellIcon className="size-3.5 text-arc" aria-hidden />}
              wins={week.trained}
              empty="Nothing logged yet."
            />
            <WinList
              title="New in your library"
              icon={<LibraryIcon className="size-3.5 text-violet" aria-hidden />}
              wins={week.pagesCreated}
              empty="No new pages this week."
            />
            <WinList
              title="What I learned about you"
              icon={<BrainIcon className="size-3.5 text-gold" aria-hidden />}
              wins={week.learned}
              empty="Nothing new picked up."
            />
          </div>
        )}
      </div>
    </main>
  );
}

const dayLabel = (ms: number) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(ms));

function WinList({
  title,
  icon,
  wins,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  wins: Win[];
  empty: string;
}) {
  return (
    <section className="mt-6">
      <h2 className="readout flex items-center gap-2">
        {icon}
        {title}
        {wins.length > 0 && <span className="text-arc">{wins.length}</span>}
      </h2>

      {wins.length === 0 ? (
        <p className="mt-2 border border-dashed border-edge px-3 py-4 text-center text-[0.76rem] text-mist">
          {empty}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {wins.slice(0, 8).map((win, i) => {
            const row = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.85rem]">{win.title}</span>
                  {win.detail && (
                    <span className="readout mt-0.5 block truncate normal-case tracking-normal">
                      {win.detail}
                    </span>
                  )}
                </span>
                <span className="readout shrink-0">{dayLabel(win.at)}</span>
              </>
            );

            return (
              <li key={`${win.title}-${win.at}-${i}`}>
                {win.href ? (
                  <Link
                    href={win.href}
                    className="flex items-center gap-3 border border-edge bg-panel/50 px-3 py-2.5 transition-colors hover:border-arc/40"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 border border-edge bg-panel/50 px-3 py-2.5">
                    {row}
                  </div>
                )}
              </li>
            );
          })}
          {wins.length > 8 && (
            <li className="readout pt-1">+{wins.length - 8} more</li>
          )}
        </ul>
      )}
    </section>
  );
}
