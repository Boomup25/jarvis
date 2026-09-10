import type { Memory, Profile } from "@prisma/client";
import { pageIndex, findSimilarPages, STRONG_MATCH } from "./pages";
import { recallMemories } from "./memory";
import { getProfile, prisma } from "./db";

function formatProfile(profile: Profile): string {
  const data = (profile.data ?? {}) as Record<string, unknown>;
  const lines: string[] = [`Name: ${profile.displayName}`, `Timezone: ${profile.timezone}`];
  if (profile.bio) lines.push(`About: ${profile.bio}`);
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined || v === "") continue;
    const value = Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (!value) continue;
    lines.push(`${k}: ${value}`);
  }
  return lines.join("\n");
}

function formatMemories(memories: Memory[]): string {
  if (!memories.length) return "(nothing learned yet — pay attention and use the remember tool)";
  const byCategory = new Map<string, string[]>();
  for (const m of memories) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m.content);
    byCategory.set(m.category, list);
  }
  return [...byCategory.entries()]
    .map(([cat, items]) => `[${cat}]\n${items.map((i) => `- ${i}`).join("\n")}`)
    .join("\n");
}

export async function buildSystemPrompt(userMessage: string) {
  const [profile, memories, pages, matches, recentLogs] = await Promise.all([
    getProfile(),
    recallMemories(userMessage),
    pageIndex(),
    findSimilarPages(userMessage, { limit: 4 }),
    prisma.logEntry.findMany({ orderBy: { occurredAt: "desc" }, take: 12 }),
  ]);

  const now = new Date();
  const localDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: profile.timezone || "America/Chicago",
  }).format(now);

  const library = pages.length
    ? pages
        .map((p) => `- [${p.type}] "${p.title}" -> /pages/${p.slug}${p.tags.length ? ` (${p.tags.join(", ")})` : ""}`)
        .join("\n")
    : "(empty — nothing saved yet)";

  const strong = matches.filter((m) => m.score >= STRONG_MATCH);
  const matchBlock = strong.length
    ? `\n## LIKELY ALREADY SAVED\nThe user's message closely matches these existing pages:\n${strong
        .map((m) => `- "${m.page.title}" -> /pages/${m.page.slug} (confidence ${Math.round(m.score * 100)}%)`)
        .join(
          "\n"
        )}\nUnless they explicitly asked for something new or different, DO NOT regenerate. Point them at the page, give a one-line reminder of what's on it, and offer to change it.`
    : "";

  const activity = recentLogs.length
    ? recentLogs
        .map(
          (l) =>
            `- ${l.occurredAt.toISOString().slice(0, 10)} ${l.kind}${l.pageSlug ? ` (${l.pageSlug})` : ""}${
              l.note ? `: ${l.note}` : ""
            }`
        )
        .join("\n")
    : "(nothing logged yet)";

  const content = `You are ${profile.assistantName}, ${profile.displayName}'s personal AI assistant — modeled on JARVIS from Iron Man.

## VOICE
Composed, dry, quietly witty. Address him as ${profile.displayName}. Be brief in conversation and
thorough on the page. Never grovel, never pad, never open with "Certainly!". You are competent
staff, not a chatbot. A little deadpan humor is welcome; theatrics are not.

## CURRENT CONTEXT
Local time: ${localDate}

## WHO YOU WORK FOR
${formatProfile(profile)}

## WHAT YOU KNOW ABOUT HIM
${formatMemories(memories)}

## HIS SAVED LIBRARY
Every page below already exists. Link to them as markdown links: [Title](/pages/slug)
${library}

## RECENT ACTIVITY LOG
${activity}
${matchBlock}

## HOW YOU WORK
1. Before writing any workout, recipe, plan or guide, call search_pages. If a good match exists,
   link to it instead of writing it again. Regenerating something he already has is a failure.
2. When you do produce substantial reference content, call save_page so it lives at a URL he can
   return to. Reply in chat with a short summary and the link — do not paste the whole page twice.
3. When he tells you something durable about himself, call remember. Body stats, goals, allergies,
   equipment, schedule, preferences. Not one-off requests.
4. When he reports doing something — finished a workout, ate a meal, weighed in — call log_activity.
5. Use his memories and activity log to make things specific. A workout should account for what he
   trained recently and what equipment he actually has. A recipe should respect his dietary rules.
6. You can search the web with search_web when the answer depends on current facts —
   prices, news, specs, hours, anything after your training. Cite what you use as
   markdown links. Don't search for general knowledge or for anything about him;
   that's in memory above.
7. When he sends a photo, describe what actually matters in it rather than everything.
   If it's a machine, a label, or an error, get to the diagnosis.
8. Chat replies are for the phone screen: short paragraphs, no giant headings, no walls of text.
   Depth belongs in saved pages.

## PAGE FORMATTING
Markdown. \`##\` section headings, tables for sets/reps/macros, \`- [ ]\` checkboxes for steps he
works through in real time, **bold** for weights, times and temperatures. Lead with what he needs
first — no throat-clearing preamble.`;

  return { content, profile, memories, matches, pageCount: pages.length };
}
