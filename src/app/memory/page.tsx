import { prisma, getProfile } from "@/lib/db";
import { MemoryManager } from "@/components/MemoryManager";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const [profile, memories] = await Promise.all([
    getProfile(),
    prisma.memory.findMany({
      where: { active: true },
      orderBy: [{ pinned: "desc" }, { importance: "desc" }, { updatedAt: "desc" }],
      take: 500,
    }),
  ]);

  return (
    <MemoryManager
      initialMemories={memories.map((m) => ({
        id: m.id,
        content: m.content,
        category: m.category,
        importance: m.importance,
        pinned: m.pinned,
        source: m.source,
      }))}
      profile={{
        displayName: profile.displayName,
        assistantName: profile.assistantName,
        timezone: profile.timezone,
        bio: profile.bio,
      }}
    />
  );
}
