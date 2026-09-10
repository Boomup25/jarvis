import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { touchPage } from "@/lib/pages";
import { Markdown } from "@/components/Markdown";
import { PageActions } from "@/components/PageActions";
import { PAGE_ICONS } from "@/components/Icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await prisma.page.findUnique({ where: { slug }, select: { title: true } });
  return { title: page ? `${page.title} · JARVIS` : "JARVIS" };
}

export default async function PageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await prisma.page.findUnique({ where: { slug } });
  if (!page) notFound();

  void touchPage(slug);

  const Icon = PAGE_ICONS[page.type as keyof typeof PAGE_ICONS] ?? PAGE_ICONS.note;

  return (
    <main className="h-full overflow-y-auto overscroll-contain px-4 pb-10 pt-6 safe-top">
      <div className="mx-auto max-w-lg">
      <Link href="/pages" className="text-[0.75rem] text-mist transition-colors hover:text-frost">
        ← Library
      </Link>

      <header className="mt-4 flex items-start gap-3">
        <Icon className="mt-1 size-5 shrink-0 text-arc" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-snug">{page.title}</h1>
          <p className="mt-1 text-[0.68rem] uppercase tracking-wider text-mist">
            {page.type} · saved{" "}
            {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
              page.createdAt
            )}
          </p>
        </div>
      </header>

      {page.summary && <p className="mt-3 text-[0.86rem] text-mist">{page.summary}</p>}

      {page.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {page.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-edge px-2.5 py-0.5 text-[0.68rem] text-mist">
              {tag}
            </span>
          ))}
        </div>
      )}

      <article className="mt-6 rounded-2xl glass p-4">
        <Markdown>{page.contentMd}</Markdown>
      </article>

      <PageActions slug={page.slug} title={page.title} type={page.type} pinned={page.pinned} />
    </div>
    </main>
  );
}
