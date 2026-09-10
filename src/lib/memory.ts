import { prisma } from "./db";
import { similarity, tokenize } from "./slug";
import { completeJson, type ChatMessage } from "./openrouter";
import { utilityModel } from "./models";

export const MEMORY_CATEGORIES = [
  "identity",
  "fitness",
  "food",
  "preference",
  "schedule",
  "goal",
  "relationship",
  "work",
  "general",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/**
 * Pick the memories worth spending context on this turn:
 * everything pinned or importance>=4, plus whatever the message looks like
 * it is about, plus a few recent ones.
 */
export async function recallMemories(query: string, limit = 40) {
  const all = await prisma.memory.findMany({
    where: { active: true },
    orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
    take: 400,
  });

  const scored = all.map((m) => {
    let score = m.importance * 0.6;
    if (m.pinned) score += 5;
    score += similarity(query, m.content) * 6;
    const ageDays = (Date.now() - m.updatedAt.getTime()) / 86_400_000;
    score += Math.max(0, 1.5 - ageDays / 30);
    return { memory: m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const chosen = scored.slice(0, limit).map((s) => s.memory);

  if (chosen.length) {
    void prisma.memory
      .updateMany({
        where: { id: { in: chosen.map((c) => c.id) } },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      })
      .catch(() => {});
  }

  return chosen;
}

/** Insert a memory, merging with a near-duplicate instead of piling up copies. */
export async function rememberFact(input: {
  content: string;
  category?: string;
  importance?: number;
  source?: string;
}) {
  const content = input.content.trim();
  if (content.length < 3) return null;

  const category = (MEMORY_CATEGORIES as readonly string[]).includes(input.category ?? "")
    ? (input.category as string)
    : "general";
  const importance = Math.min(5, Math.max(1, input.importance ?? 3));

  const candidates = await prisma.memory.findMany({
    where: { active: true, category },
    orderBy: { updatedAt: "desc" },
    take: 120,
  });

  const tokens = tokenize(content);
  for (const c of candidates) {
    const sim = Math.min(similarity(content, c.content), similarity(c.content, content));
    if (sim >= 0.75 && tokens.length > 1) {
      // Same fact, possibly updated wording — keep the newer phrasing.
      return prisma.memory.update({
        where: { id: c.id },
        data: { content, importance: Math.max(c.importance, importance) },
      });
    }
  }

  return prisma.memory.create({
    data: { content, category, importance, source: input.source ?? "chat" },
  });
}

interface ExtractedFact {
  content: string;
  category: string;
  importance: number;
}

/**
 * Background pass after a turn: pull durable facts out of what the user said.
 * Deliberately conservative — one-off requests are not memories.
 */
export async function extractMemories(userText: string, assistantText: string) {
  if (userText.trim().length < 12) return [];

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You extract durable personal facts about the user from a conversation.

Return JSON: {"facts": [{"content": string, "category": string, "importance": 1-5}]}

Rules:
- Only facts that stay true for weeks or longer: body stats, goals, dietary rules,
  allergies, equipment they own, schedule patterns, preferences, relationships, job.
- NOT one-off requests ("make me a chicken dish tonight"), NOT the assistant's advice,
  NOT anything the assistant made up.
- Write each fact as a short third-person statement: "Prefers training in the morning."
- category is one of: identity, fitness, food, preference, schedule, goal, relationship, work, general
- importance: 5 = core identity/medical, 3 = useful preference, 1 = trivia.
- If there is nothing durable, return {"facts": []}. Empty is the correct answer most of the time.`,
    },
    {
      role: "user",
      content: `USER SAID:\n${userText.slice(0, 4000)}\n\nASSISTANT REPLIED:\n${assistantText.slice(0, 1500)}`,
    },
  ];

  const result = await completeJson<{ facts: ExtractedFact[] }>({
    messages,
    model: utilityModel(),
    maxTokens: 600,
  });

  if (!result?.facts?.length) return [];

  const saved = [];
  for (const fact of result.facts.slice(0, 6)) {
    if (typeof fact?.content !== "string") continue;
    const mem = await rememberFact({
      content: fact.content,
      category: fact.category,
      importance: Number(fact.importance) || 3,
      source: "auto",
    });
    if (mem) saved.push(mem);
  }
  return saved;
}
