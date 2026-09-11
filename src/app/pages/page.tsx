import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { PAGE_TYPES } from "@/lib/pages";
import { PAGE_ICONS, LibraryIcon } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { type } = await searchParams;
  const filter = PAGE_TYPES.includes(type as never) ? type : undefined;

  const pages = await prisma.page.findMany({
    where: { userId: user.id, archived: false, ...(filter ? { type: filter } : {}) },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  const counts = await prisma.page.groupBy({
    by: ["type"],
    where: { userId: user.id, archived: false },
    _count: true,
  });
  const countFor = (t: string) => counts.find((c) => c.type === t)?._count ?? 0;

  return (
    <main className="h-full overflow-y-auto overscroll-contain px-4 pb-10 pt-8 safe-top">
      <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold">Library</h1>
      <p className="mt-1 text-[0.8rem] text-mist">
        Everything JARVIS has written down for you.
      </p>

      <div className="-mx-4 mt-4 overflow-x-auto px-4">
        <div className="flex gap-2 pb-1">
          <FilterChip href="/pages" active={!filter} label="All" count={pages.length && !filter ? pages.length : counts.reduce((a, c) => a + c._count, 0)} />
          {PAGE_TYPES.map((t) => (
            <FilterChip key={t} href={`/pages?type=${t}`} active={filter === t} label={t} count={countFor(t)} />
          ))}
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-edge px-4 py-12 text-center">
          <LibraryIcon className="mx-auto size-9 text-mist/60" />
          <p className="mt-3 text-[0.88rem]">Nothing here yet.</p>
          <p className="mt-1 text-[0.78rem] text-mist">
            Ask JARVIS for a workout or a recipe and it lands here automatically.
          </p>
          <Link href="/chat" className="mt-5 inline-block rounded-full bg-arc px-5 py-2 text-[0.8rem] font-semibold text-void">
            Start
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {pages.map((page) => {
            const Icon = PAGE_ICONS[page.type as keyof typeof PAGE_ICONS] ?? PAGE_ICONS.note;
            return (
              <li key={page.slug}>
                <Link
                  href={`/pages/${page.slug}`}
                  className="block rounded-xl border border-edge bg-panel/50 p-3.5 transition-colors hover:border-arc/40"
                >
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 size-4 shrink-0 text-arc" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.92rem] font-medium">{page.title}</p>
                      {page.summary && (
                        <p className="mt-0.5 line-clamp-2 text-[0.78rem] text-mist">{page.summary}</p>
                      )}
                      <p className="mt-1.5 text-[0.66rem] uppercase tracking-wider text-mist/70">
                        {page.type} ·{" "}
                        {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(page.updatedAt)}
                        {page.viewCount > 0 ? ` · ${page.viewCount} views` : ""}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
    </main>
  );
}

function FilterChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-[0.75rem] capitalize transition-colors ${
        active ? "border-arc/50 bg-arc/12 text-arc" : "border-edge text-mist hover:text-frost"
      }`}
    >
      {label}
      {count > 0 && <span className="ml-1.5 text-[0.65rem] opacity-70">{count}</span>}
    </Link>
  );
}
