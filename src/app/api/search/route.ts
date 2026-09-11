import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export interface SearchHit {
  kind: "page" | "memory" | "conversation";
  id: string;
  title: string;
  snippet: string;
  url: string;
  when: string;
  score: number;
}

/** A short window of text around the match, so you can see why it matched. */
function snippet(text: string, query: string, radius = 90): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Search across everything this account owns.
 *
 * Postgres ILIKE rather than full-text: at personal-app scale it's fast,
 * it needs no extra index or migration, and it matches partial words — which
 * is what you actually want when you half-remember a phrase.
 */
export async function GET(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const userId = auth.user.id;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ hits: [], query: q });

  const contains = { contains: q, mode: "insensitive" as const };

  const [pages, memories, messages] = await Promise.all([
    prisma.page.findMany({
      where: {
        userId,
        archived: false,
        OR: [{ title: contains }, { summary: contains }, { contentMd: contains }, { tags: { has: q.toLowerCase() } }],
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.memory.findMany({
      where: { userId, active: true, content: contains },
      orderBy: { importance: "desc" },
      take: 20,
    }),
    prisma.message.findMany({
      where: { content: contains, conversation: { userId } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { conversation: { select: { id: true, title: true } } },
    }),
  ]);

  const hits: SearchHit[] = [];

  for (const page of pages) {
    // A title match is what you meant; a body match is a maybe.
    const inTitle = page.title.toLowerCase().includes(q.toLowerCase());
    hits.push({
      kind: "page",
      id: page.slug,
      title: page.title,
      snippet: page.summary || snippet(page.contentMd, q),
      url: `/pages/${page.slug}`,
      when: page.updatedAt.toISOString(),
      score: inTitle ? 100 : 60,
    });
  }

  for (const memory of memories) {
    hits.push({
      kind: "memory",
      id: memory.id,
      title: memory.category,
      snippet: memory.content,
      url: "/memory",
      when: memory.updatedAt.toISOString(),
      score: 50 + memory.importance * 4,
    });
  }

  const seenConversations = new Set<string>();
  for (const message of messages) {
    if (seenConversations.has(message.conversationId)) continue;
    seenConversations.add(message.conversationId);
    hits.push({
      kind: "conversation",
      id: message.conversationId,
      title: message.conversation.title,
      snippet: snippet(message.content, q),
      url: `/chat?c=${message.conversationId}`,
      when: message.createdAt.toISOString(),
      score: 40,
    });
  }

  hits.sort((a, b) => b.score - a.score || b.when.localeCompare(a.when));

  return Response.json({ query: q, hits: hits.slice(0, 30) });
}
