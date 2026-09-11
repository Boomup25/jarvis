import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, getProfile } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { buildInsights } from "@/lib/insights";
import { Greeting } from "@/components/Greeting";
import { ReactorOrb } from "@/components/ReactorOrb";
import { ActivityHeatmap, WeekTrend } from "@/components/DashboardCharts";
import {
  InsightRow,
  RecommendationRow,
  SectionTitle,
  StatTile,
} from "@/components/DashboardCards";
import { CheckIcon, PAGE_ICONS, SparkIcon } from "@/components/Icons";
import { DashboardHeaderActions } from "@/components/DashboardHeaderActions";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const [profile, insights, tasks, recentPages] = await Promise.all([
    getProfile(user.id),
    buildInsights(user.id),
    prisma.task.findMany({
      where: { userId: user.id, done: false },
      orderBy: [{ dueAt: "asc" }],
      take: 6,
    }),
    prisma.page.findMany({
      where: { userId: user.id, archived: false },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 6,
      select: { slug: true, title: true, type: true },
    }),
  ]);

  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: profile.timezone,
  }).format(now);

  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: profile.timezone }).format(now)
  );
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  const hasData = insights.totals.logs > 0 || insights.totals.pages > 0;
  const hasRail = tasks.length > 0 || recentPages.length > 0 || insights.topPages.length > 0;

  return (
    <main className="h-full overflow-y-auto overscroll-contain px-4 pb-10 page-top lg:px-8 lg:page-top-wide">
      <div className="mx-auto w-full max-w-lg md:max-w-2xl lg:max-w-6xl">
        <DashboardHeaderActions isOwner={user.role === "owner"} />

        {/*
          One column on a phone, main + rail from lg. The rail only exists when
          there's something to put in it, so a new account doesn't stare at a
          column of empty headings.
        */}
        <div className={`lg:grid lg:gap-7 ${hasRail ? "lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_21rem]" : "lg:grid-cols-1"}`}>
          {/* ---- main column ------------------------------------------- */}
          <div className="min-w-0">
            {/* ---- hero ------------------------------------------------ */}
            <section className="relative flex flex-col items-center pt-2 text-center lg:flex-row lg:items-center lg:gap-8 lg:pt-0 lg:text-left">
              <div className="pointer-events-none absolute inset-x-0 -top-16 h-56 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(79,216,255,0.16),transparent_70%)] lg:left-0 lg:right-auto lg:top-1/2 lg:h-72 lg:w-72 lg:-translate-y-1/2" />

              {/* The reactor is the obvious thing to reach for, so it opens the chat. */}
              <Link
                href="/chat"
                aria-label="Talk to JARVIS"
                className="relative block shrink-0 transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-arc"
              >
                <ReactorOrb state="idle" className="size-40 lg:size-44" />
              </Link>

              <div className="relative flex w-full min-w-0 flex-col items-center lg:items-start">
                <p className="readout mt-1 lg:mt-0">{dateLabel}</p>
                <h1 className="mt-1 text-xl font-semibold lg:text-3xl">
                  Good {partOfDay}, {profile.displayName}.
                </h1>

                <div className="mt-4 w-full glass p-4 lg:mt-3">
                  <Greeting
                    fallback={
                      hasData
                        ? `${insights.totals.pages} pages saved, ${insights.totals.memories} things remembered.`
                        : "Nothing on record yet. Start a conversation and I'll begin building your picture."
                    }
                  />
                </div>

                <Link
                  href="/chat"
                  className="notch-tr mt-3 flex w-full items-center justify-center gap-2 border border-arc/60 bg-arc/[0.12] py-3.5 text-[0.8rem] font-semibold uppercase tracking-[0.2em] text-arc transition-colors hover:bg-arc/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-arc lg:w-auto lg:px-9"
                >
                  Talk to JARVIS
                </Link>
              </div>
            </section>

            {/* ---- KPI row --------------------------------------------- */}
            <section className="mt-6 grid grid-cols-4 gap-2 lg:mt-8 lg:gap-3">
              <StatTile
                label="This week"
                value={insights.thisWeek}
                delta={insights.lastWeek > 0 || insights.thisWeek > 0 ? insights.weekDelta : undefined}
              />
              <StatTile label="Day streak" value={insights.streakDays} accent="var(--color-gold)" />
              <StatTile label="Pages" value={insights.totals.pages} accent="var(--color-violet)" />
              <StatTile label="Memories" value={insights.totals.memories} accent="var(--color-jade)" />
            </section>

            {/* The bottom tab bar is full at four, so the week lives behind a
                link here rather than a fifth tab nobody can reach with a thumb. */}
            <Link
              href="/week"
              className="notch-tr mt-2 flex items-center justify-between gap-3 border border-edge bg-panel/40 px-3.5 py-3 transition-colors hover:border-arc/40"
            >
              <span className="flex items-center gap-2.5 text-[0.85rem]">
                <SparkIcon className="size-4 shrink-0 text-gold" aria-hidden />
                Your week in full
              </span>
              <span className="readout">
                {insights.thisWeek} {insights.thisWeek === 1 ? "session" : "sessions"} →
              </span>
            </Link>

            {/* ---- charts ---------------------------------------------- */}
            {insights.totals.logs > 0 ? (
              <section className="mt-6 glass p-4 lg:p-6">
                <ActivityHeatmap cells={insights.heatmap} />
                <hr className="my-5 border-edge/60" />
                <WeekTrend series={insights.weeklySeries} />
              </section>
            ) : (
              <section className="mt-6 border border-dashed border-edge px-4 py-8 text-center">
                <p className="text-[0.85rem]">No activity tracked yet.</p>
                <p className="mt-1 text-[0.75rem] leading-snug text-mist">
                  Open a workout page and hit <span className="text-frost">Mark workout complete</span>.
                  Once there&rsquo;s a week of data, this fills with your training pattern.
                </p>
              </section>
            )}

            {/* ---- insights + recommendations, side by side when wide --- */}
            {(insights.insights.length > 0 || insights.recommendations.length > 0) && (
              <div className="xl:grid xl:grid-cols-2 xl:gap-6">
                {insights.insights.length > 0 && (
                  <section className="mt-6">
                    <SectionTitle>What I&rsquo;m seeing</SectionTitle>
                    <ul className="mt-2 space-y-1.5">
                      {insights.insights.map((insight, i) => (
                        <InsightRow key={i} insight={insight} />
                      ))}
                    </ul>
                  </section>
                )}

                {insights.recommendations.length > 0 && (
                  <section className="mt-6">
                    <SectionTitle>Suggested next</SectionTitle>
                    <ul className="mt-2 space-y-1.5">
                      {insights.recommendations.map((rec, i) => (
                        <RecommendationRow key={i} rec={rec} />
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>

          {/* ---- right rail ------------------------------------------- */}
          {hasRail && (
            <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start">
              {tasks.length > 0 && (
                <section className="mt-6 lg:mt-0">
                  <SectionTitle>Open tasks</SectionTitle>
                  <ul className="mt-2 space-y-1.5">
                    {tasks.map((task) => (
                      <li
                        key={task.id}
                        className="flex items-center gap-3 border border-edge bg-panel/50 px-3 py-2.5"
                      >
                        <CheckIcon className="size-4 shrink-0 text-mist" aria-hidden />
                        <span className="flex-1 truncate text-[0.85rem]">{task.title}</span>
                        {task.dueAt && (
                          <span className="shrink-0 text-[0.64rem] text-mist">
                            {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(task.dueAt)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {recentPages.length > 0 && (
                <section className="mt-6">
                  <SectionTitle
                    action={
                      <Link href="/pages" className="text-[0.72rem] text-arc hover:underline">
                        All {insights.totals.pages}
                      </Link>
                    }
                  >
                    Recent pages
                  </SectionTitle>
                  <ul className="mt-2 space-y-1.5">
                    {recentPages.map((page) => {
                      const Icon = PAGE_ICONS[page.type as keyof typeof PAGE_ICONS] ?? PAGE_ICONS.note;
                      return (
                        <li key={page.slug}>
                          <Link
                            href={`/pages/${page.slug}`}
                            className="flex items-center gap-3 border border-edge bg-panel/50 px-3 py-2.5 transition-colors hover:border-arc/40"
                          >
                            <Icon className="size-4 shrink-0 text-arc" aria-hidden />
                            <span className="flex-1 truncate text-[0.85rem]">{page.title}</span>
                            <span className="shrink-0 text-[0.64rem] uppercase tracking-wider text-mist">
                              {page.type}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {insights.topPages.length > 0 && (
                <section className="mt-6">
                  <SectionTitle>Most used</SectionTitle>
                  <ul className="mt-2 space-y-1.5">
                    {insights.topPages.map((page) => (
                      <li key={page.slug}>
                        <Link
                          href={`/pages/${page.slug}`}
                          className="flex items-center gap-3 border border-edge bg-panel/50 px-3 py-2.5 transition-colors hover:border-arc/40"
                        >
                          <span className="flex-1 truncate text-[0.85rem]">{page.title}</span>
                          <span className="shrink-0 font-mono text-[0.68rem] text-arc">
                            {page.viewCount}×
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
