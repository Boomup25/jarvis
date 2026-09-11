import { prisma } from "./db";
import { similarity, slugify } from "./slug";
import type { Page } from "@prisma/client";

export const PAGE_TYPES = ["workout", "recipe", "plan", "guide", "note"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const PAGE_TYPE_META: Record<PageType, { label: string; icon: string; accent: string }> = {
  workout: { label: "Workout", icon: "dumbbell", accent: "var(--accent-cyan)" },
  recipe: { label: "Recipe", icon: "pot", accent: "var(--accent-amber)" },
  plan: { label: "Plan", icon: "calendar", accent: "var(--accent-violet)" },
  guide: { label: "Guide", icon: "book", accent: "var(--accent-green)" },
  note: { label: "Note", icon: "note", accent: "var(--accent-slate)" },
};

export function normalizeType(input?: string | null): PageType {
  const t = (input ?? "").toLowerCase();
  return (PAGE_TYPES as readonly string[]).includes(t) ? (t as PageType) : "note";
}

/** Give a page a unique slug, suffixing -2, -3… if the base is taken. */
export async function uniqueSlug(userId: string, title: string, preferred?: string): Promise<string> {
  const base = slugify(preferred || title);
  let candidate = base;
  let n = 2;
  while (await prisma.page.findUnique({ where: { userId_slug: { userId, slug: candidate } }, select: { id: true } })) {
    candidate = `${base}-${n++}`;
    if (n > 50) return `${base}-${Date.now().toString(36)}`;
  }
  return candidate;
}

export interface PageMatch {
  page: Page;
  score: number;
}

/**
 * The heart of "don't regenerate what you already made".
 * Scores every non-archived page against the user's message.
 */
export async function findSimilarPages(userId: string, query: string, opts?: { type?: string; limit?: number }): Promise<PageMatch[]> {
  const pages = await prisma.page.findMany({
    where: { userId, archived: false, ...(opts?.type ? { type: normalizeType(opts.type) } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const matches = pages
    .map((page) => {
      const titleScore = similarity(query, page.title) * 1.0;
      const tagScore = similarity(query, page.tags.join(" ")) * 0.6;
      const summaryScore = similarity(query, page.summary) * 0.35;
      // Reverse direction matters too: a short title fully contained in a long
      // question should still win.
      const containment = similarity(page.title, query) * 0.7;
      const score = Math.min(1, titleScore + tagScore + summaryScore + containment);
      return { page, score };
    })
    .filter((m) => m.score > 0.28)
    .sort((a, b) => b.score - a.score);

  return matches.slice(0, opts?.limit ?? 5);
}

/** Above this, we tell the model flatly: link to it, do not rewrite it. */
export const STRONG_MATCH = 0.62;

/** Compact index of the library, injected into every system prompt. */
export async function pageIndex(userId: string, limit = 120) {
  const pages = await prisma.page.findMany({
    where: { userId, archived: false },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: { slug: true, title: true, type: true, tags: true, updatedAt: true },
  });
  return pages;
}

export async function touchPage(userId: string, slug: string) {
  return prisma.page
    .update({
      where: { userId_slug: { userId, slug } },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    })
    .catch(() => null);
}
