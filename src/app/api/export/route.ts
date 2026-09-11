import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Everything this account owns, as one JSON file.
 *
 * Your data living in exactly one managed database is a single point of
 * failure; this is the escape hatch. Scoped to the caller, so a member
 * exports their own data and nobody else's.
 */
export async function GET() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const userId = auth.user.id;

  const [profile, memories, pages, tasks, logs, conversations] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.memory.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.page.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.task.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.logEntry.findMany({ where: { userId }, orderBy: { occurredAt: "asc" } }),
    prisma.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          // Thumbnails would balloon the file for little benefit.
          select: { role: true, content: true, model: true, createdAt: true },
        },
      },
    }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    account: { username: auth.user.username, displayName: auth.user.displayName },
    profile,
    memories,
    pages,
    tasks,
    logs,
    conversations,
    counts: {
      memories: memories.length,
      pages: pages.length,
      tasks: tasks.length,
      logs: logs.length,
      conversations: conversations.length,
    },
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="jarvis-${auth.user.username}-${stamp}.json"`,
    },
  });
}
