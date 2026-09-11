/**
 * The tools JARVIS can call. Adding a capability = adding an entry here;
 * the chat loop picks it up automatically.
 */

import { prisma } from "./db";
import { rememberFact } from "./memory";
import { findSimilarPages, normalizeType, uniqueSlug, PAGE_TYPES } from "./pages";
import { webSearch } from "./openrouter";
import type { ToolSchema } from "./openrouter";

export interface ToolContext {
  /** Whose data this tool may touch. Every query below is scoped to it. */
  userId: string;
  /** Emitted to the client so the UI can render a card the moment it happens. */
  emit: (event: { type: string; [k: string]: unknown }) => void;
}

export interface ToolResult {
  ok: boolean;
  [k: string]: unknown;
}

type Handler = (args: any, ctx: ToolContext) => Promise<ToolResult>;

interface ToolDef {
  schema: ToolSchema;
  handler: Handler;
}

const tools: Record<string, ToolDef> = {
  save_page: {
    schema: {
      type: "function",
      function: {
        name: "save_page",
        description:
          "Save a reference page the user will come back to: a workout, a recipe, a plan, a guide. " +
          "Call this whenever you produce substantial content worth keeping. " +
          "Do NOT call it for small talk or short answers. " +
          "Always search_pages first — if a page for this already exists, link to it instead.",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...PAGE_TYPES], description: "Kind of page" },
            title: { type: "string", description: "Short human title, e.g. 'Push Day A' or 'Chicken Tikka Masala'" },
            summary: { type: "string", description: "One sentence describing it" },
            content_md: {
              type: "string",
              description:
                "The full page body in Markdown. Use ## headings, tables for sets/reps, " +
                "- [ ] checkboxes for steps the user works through, and bold for key numbers.",
            },
            tags: { type: "array", items: { type: "string" }, description: "3-6 lowercase keywords for later search" },
          },
          required: ["type", "title", "content_md"],
        },
      },
    },
    handler: async (args, ctx) => {
      const title = String(args.title ?? "").trim();
      const contentMd = String(args.content_md ?? "").trim();
      if (!title || !contentMd) return { ok: false, error: "title and content_md are required" };

      const type = normalizeType(args.type);
      const slug = await uniqueSlug(ctx.userId, title);
      const tags = Array.isArray(args.tags)
        ? args.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 8)
        : [];

      const page = await prisma.page.create({
        data: { userId: ctx.userId, slug, type, title, summary: String(args.summary ?? "").trim(), contentMd, tags },
      });

      ctx.emit({ type: "page_saved", slug: page.slug, title: page.title, pageType: page.type });
      return { ok: true, slug: page.slug, url: `/pages/${page.slug}`, title: page.title };
    },
  },

  search_pages: {
    schema: {
      type: "function",
      function: {
        name: "search_pages",
        description:
          "Search the pages already saved. ALWAYS call this before generating a workout, recipe, " +
          "plan or guide, so you can link to an existing page instead of writing a new one.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What the user is asking about" },
            type: { type: "string", enum: [...PAGE_TYPES], description: "Optional filter" },
          },
          required: ["query"],
        },
      },
    },
    handler: async (args, ctx) => {
      const matches = await findSimilarPages(ctx.userId, String(args.query ?? ""), { type: args.type, limit: 5 });
      return {
        ok: true,
        results: matches.map((m) => ({
          slug: m.page.slug,
          url: `/pages/${m.page.slug}`,
          title: m.page.title,
          type: m.page.type,
          summary: m.page.summary,
          confidence: Math.round(m.score * 100) / 100,
          updated: m.page.updatedAt.toISOString().slice(0, 10),
        })),
      };
    },
  },

  update_page: {
    schema: {
      type: "function",
      function: {
        name: "update_page",
        description:
          "Revise an existing page in place — e.g. the user wants heavier weights on a workout " +
          "or a swapped ingredient. Prefer this over creating a near-duplicate page.",
        parameters: {
          type: "object",
          properties: {
            slug: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            content_md: { type: "string", description: "The complete new body, not a diff" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["slug"],
        },
      },
    },
    handler: async (args, ctx) => {
      const slug = String(args.slug ?? "");
      const existing = await prisma.page.findUnique({
        where: { userId_slug: { userId: ctx.userId, slug } },
      });
      if (!existing) return { ok: false, error: `No page with slug "${slug}"` };

      const page = await prisma.page.update({
        where: { userId_slug: { userId: ctx.userId, slug } },
        data: {
          ...(args.title ? { title: String(args.title) } : {}),
          ...(args.summary ? { summary: String(args.summary) } : {}),
          ...(args.content_md ? { contentMd: String(args.content_md) } : {}),
          ...(Array.isArray(args.tags)
            ? { tags: args.tags.map((t: unknown) => String(t).toLowerCase()).slice(0, 8) }
            : {}),
        },
      });

      ctx.emit({ type: "page_saved", slug: page.slug, title: page.title, pageType: page.type });
      return { ok: true, slug: page.slug, url: `/pages/${page.slug}` };
    },
  },

  remember: {
    schema: {
      type: "function",
      function: {
        name: "remember",
        description:
          "Store a durable fact about the user so future conversations know it. " +
          "Use for body stats, goals, allergies, equipment, schedule, preferences. " +
          "Do not store one-off requests.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "Short third-person statement, e.g. 'Trains 5 days a week, PPL split.'" },
            category: {
              type: "string",
              enum: ["identity", "fitness", "food", "preference", "schedule", "goal", "relationship", "work", "general"],
            },
            importance: { type: "integer", minimum: 1, maximum: 5 },
          },
          required: ["content"],
        },
      },
    },
    handler: async (args, ctx) => {
      const mem = await rememberFact({
        userId: ctx.userId,
        content: String(args.content ?? ""),
        category: args.category,
        importance: Number(args.importance) || 3,
        source: "tool",
      });
      if (!mem) return { ok: false, error: "content too short" };
      ctx.emit({ type: "memory_saved", content: mem.content, category: mem.category });
      return { ok: true, id: mem.id };
    },
  },

  add_task: {
    schema: {
      type: "function",
      function: {
        name: "add_task",
        description: "Add something to the user's task list.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            notes: { type: "string" },
            due_at: { type: "string", description: "ISO 8601 datetime, optional" },
          },
          required: ["title"],
        },
      },
    },
    handler: async (args, ctx) => {
      const title = String(args.title ?? "").trim();
      if (!title) return { ok: false, error: "title required" };
      const dueAt = args.due_at ? new Date(String(args.due_at)) : null;
      const task = await prisma.task.create({
        data: {
          userId: ctx.userId,
          title,
          notes: String(args.notes ?? ""),
          dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
        },
      });
      ctx.emit({ type: "task_added", id: task.id, title: task.title });
      return { ok: true, id: task.id };
    },
  },

  list_tasks: {
    schema: {
      type: "function",
      function: {
        name: "list_tasks",
        description: "Read the user's open tasks.",
        parameters: {
          type: "object",
          properties: { include_done: { type: "boolean" } },
        },
      },
    },
    handler: async (args, ctx) => {
      const tasks = await prisma.task.findMany({
        where: args?.include_done ? { userId: ctx.userId } : { userId: ctx.userId, done: false },
        orderBy: [{ done: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
        take: 50,
      });
      return {
        ok: true,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          done: t.done,
          due: t.dueAt?.toISOString() ?? null,
        })),
      };
    },
  },

  log_activity: {
    schema: {
      type: "function",
      function: {
        name: "log_activity",
        description:
          "Record that the user did something: finished a workout, ate a meal, weighed in. " +
          "Use this when they report a result, so progress can be tracked over time.",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["workout", "meal", "weight", "note"] },
            page_slug: { type: "string", description: "The page this relates to, if any" },
            note: { type: "string" },
            value: { type: "object", description: "Structured numbers, e.g. {\"weightLb\": 184} or {\"sets\": 20}" },
          },
          required: ["kind"],
        },
      },
    },
    handler: async (args, ctx) => {
      const kind = ["workout", "meal", "weight", "note"].includes(args?.kind) ? args.kind : "note";
      const slug = args.page_slug ? String(args.page_slug) : null;
      const exists = slug
        ? await prisma.page.findUnique({
            where: { userId_slug: { userId: ctx.userId, slug } },
            select: { slug: true },
          })
        : null;
      const entry = await prisma.logEntry.create({
        data: {
          userId: ctx.userId,
          kind,
          pageSlug: exists?.slug ?? null,
          note: String(args.note ?? ""),
          value: typeof args.value === "object" && args.value ? args.value : {},
        },
      });
      ctx.emit({ type: "activity_logged", kind, id: entry.id });
      return { ok: true, id: entry.id };
    },
  },

  search_web: {
    schema: {
      type: "function",
      function: {
        name: "search_web",
        description:
          "Search the web for current information you don't already know: prices, news, " +
          "product specs, opening hours, sports results, documentation, anything that " +
          "changed after your training. Costs a small amount per search, so use it when " +
          "the answer genuinely depends on current facts — not for general knowledge, " +
          "and not for anything about the user, which is in memory.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "A specific, well-formed search question" },
          },
          required: ["query"],
        },
      },
    },
    handler: async (args, ctx) => {
      const query = String(args.query ?? "").trim();
      if (!query) return { ok: false, error: "query required" };

      ctx.emit({ type: "searching", query });
      try {
        const { answer, citations } = await webSearch(query);
        ctx.emit({ type: "sources", citations });
        return {
          ok: true,
          answer,
          sources: citations,
          note: "Cite these as markdown links when you use them.",
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "search failed" };
      }
    },
  },

  recent_activity: {
    schema: {
      type: "function",
      function: {
        name: "recent_activity",
        description:
          "Look at what the user has actually done recently — which workouts, what they ate, weigh-ins. " +
          "Use this before planning a new workout so you don't repeat yesterday's muscle groups.",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["workout", "meal", "weight", "note"] },
            days: { type: "integer", description: "How far back to look, default 14" },
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const days = Math.min(365, Math.max(1, Number(args?.days) || 14));
      const since = new Date(Date.now() - days * 86_400_000);
      const logs = await prisma.logEntry.findMany({
        where: {
          userId: ctx.userId,
          occurredAt: { gte: since },
          ...(args?.kind ? { kind: String(args.kind) } : {}),
        },
        orderBy: { occurredAt: "desc" },
        take: 60,
      });
      return {
        ok: true,
        entries: logs.map((l) => ({
          kind: l.kind,
          page: l.pageSlug,
          note: l.note,
          value: l.value,
          when: l.occurredAt.toISOString(),
        })),
      };
    },
  },
};

export function toolSchemas(): ToolSchema[] {
  return Object.values(tools).map((t) => t.schema);
}

export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolResult> {
  const def = tools[name];
  if (!def) return { ok: false, error: `Unknown tool "${name}"` };

  let args: any = {};
  if (rawArgs?.trim()) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      // Some free models emit trailing commas or wrap args in prose.
      const start = rawArgs.indexOf("{");
      const end = rawArgs.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          args = JSON.parse(rawArgs.slice(start, end + 1));
        } catch {
          return { ok: false, error: "Arguments were not valid JSON. Retry with strict JSON." };
        }
      } else {
        return { ok: false, error: "Arguments were not valid JSON. Retry with strict JSON." };
      }
    }
  }

  try {
    return await def.handler(args, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
