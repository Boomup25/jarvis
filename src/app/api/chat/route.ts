/**
 * The chat loop.
 *
 * Streams NDJSON events back to the browser (one JSON object per line):
 *   {"type":"model","model":"..."}          which model answered
 *   {"type":"match","pages":[...]}          existing pages that look relevant
 *   {"type":"text","delta":"..."}           assistant text
 *   {"type":"tool_start","name":"..."}      a tool is running
 *   {"type":"page_saved","slug":"...",...}  emitted by tools
 *   {"type":"memory_saved",...}
 *   {"type":"done","conversationId":"..."}
 *   {"type":"error","message":"..."}
 */

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { rateLimit, clientKey, tooMany } from "@/lib/ratelimit";
import { quotaFor, recordUsage } from "@/lib/users";
import { logEvent } from "@/lib/logger";
import { buildSystemPrompt } from "@/lib/prompt";
import { streamChat, discoverVisionModels, type ChatMessage, type ToolCall } from "@/lib/openrouter";
import { runTool, toolSchemas } from "@/lib/tools";
import { bridgeContextFor } from "@/lib/bridgeTools";
import { BRIDGE_COOKIE, readUnlockToken, isOwnerUser } from "@/lib/bridge";
import { extractMemories } from "@/lib/memory";
import { findSimilarPages, STRONG_MATCH } from "@/lib/pages";
import { completeJson } from "@/lib/openrouter";
import { utilityModel, resolveChain } from "@/lib/models";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_TOOL_ROUNDS = 4;
const HISTORY_LIMIT = 20;

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const { user } = auth;
  const userId = user.id;

  // Two ceilings: a burst limit so nobody can hammer the endpoint, and a
  // monthly quota so an invited friend can't run up an unbounded bill on the
  // owner's OpenRouter key.
  const burst = rateLimit(clientKey(req, `chat:${userId}`), { limit: 30, windowMs: 5 * 60_000 });
  if (!burst.ok) return tooMany(burst, "Slow down a moment.");

  const quota = await quotaFor(user, "chat");
  if (quota.exceeded) {
    return Response.json(
      {
        error: `You've used all ${quota.limit} messages for this month.`,
        quota,
      },
      { status: 429 }
    );
  }

  let body: {
    message?: string;
    conversationId?: string;
    models?: string[];
    /** Full-size data URL, sent to the model and never stored. */
    image?: string;
    /** Downscaled data URL, stored so the transcript still shows the photo. */
    thumbnail?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const userText = String(body.message ?? "").trim().slice(0, 8000);
  const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;

  if (!userText && !image) return Response.json({ error: "Empty message" }, { status: 400 });

  // Guard the payload: a phone photo can be several MB before downscaling.
  if (image && image.length > 8_000_000) {
    return Response.json({ error: "Image too large" }, { status: 413 });
  }

  // findFirst with userId, not findUnique by id — otherwise someone could
  // resume a conversation belonging to another account by guessing its id.
  const conversation = body.conversationId
    ? await prisma.conversation.findFirst({ where: { id: body.conversationId, userId } })
    : null;

  const convo =
    conversation ??
    (await prisma.conversation.create({
      data: { userId, title: userText.slice(0, 60) || "Photo" },
    }));

  await prisma.message.create({
    data: {
      conversationId: convo.id,
      role: "user",
      content: userText || "(photo)",
      imageUrl: typeof body.thumbnail === "string" ? body.thumbnail : null,
    },
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* client went away */
        }
      };

      try {
        // Deterministic pre-check: surface existing pages before the model
        // even starts, so the UI can show "you already have this".
        const matches = await findSimilarPages(userId, userText, { limit: 4 });
        if (matches.length) {
          send({
            type: "match",
            pages: matches.map((m) => ({
              slug: m.page.slug,
              title: m.page.title,
              pageType: m.page.type,
              score: Math.round(m.score * 100),
              strong: m.score >= STRONG_MATCH,
            })),
          });
        }

        const { content: systemPrompt } = await buildSystemPrompt(userId, userText);

        // A model picked in the UI leads; the free chain stays behind it so a
        // rate-limited or retired choice still produces an answer.
        const settings = await getSettings(userId);
        let chain = body.models?.length ? body.models : resolveChain(settings.model);

        // A photo needs a model that can actually see it. The free default
        // chain already can, but a text-only paid model would silently ignore
        // the image — so swap in vision-capable models for this turn.
        if (image) {
          const vision = await discoverVisionModels();
          if (vision.length) {
            const preferred = chain.filter((m) => vision.includes(m));
            chain = [...preferred, ...vision.filter((m) => !preferred.includes(m))];
          }
        }

        const history = await prisma.message.findMany({
          where: { conversationId: convo.id },
          orderBy: { createdAt: "desc" },
          take: HISTORY_LIMIT,
        });
        history.reverse();

        const messages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          ...history
            .filter((m) => m.role === "user" || m.role === "assistant")
            .filter((m) => m.content.trim().length > 0)
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ];

        // Attach the photo to the latest turn only. Replaying old images on
        // every subsequent message would multiply cost for little benefit.
        if (image) {
          messages[messages.length - 1] = {
            role: "user",
            content: [
              { type: "text", text: userText || "What am I looking at?" },
              { type: "image_url", image_url: { url: image } },
            ],
          };
        }

        let finalText = "";
        let usedModel = "";

        /*
         * Can this turn touch the user's computer?
         *
         * Exactly the same gate as the panel — owner account, a live unlock,
         * and an agent actually connected. Resolved once per request: if the
         * answer is no, the computer_* schemas are never handed to the model,
         * which is why JARVIS says it can't rather than promising and failing.
         */
        const unlockedFor = await readUnlockToken(
          (await cookies()).get(BRIDGE_COOKIE)?.value
        );
        const bridge =
          unlockedFor === userId && isOwnerUser(user)
            ? await bridgeContextFor(userId)
            : null;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const result = await streamChat({
            messages,
            tools: toolSchemas({ bridge }),
            models: chain,
            signal: req.signal,
            onDelta: (delta) => send({ type: "text", delta }),
            onModel: (model) => {
              if (model !== usedModel) {
                usedModel = model;
                send({ type: "model", model });
              }
            },
          });

          finalText += result.text;

          if (!result.toolCalls.length) break;

          messages.push({
            role: "assistant",
            content: result.text || null,
            tool_calls: result.toolCalls,
          });

          for (const call of result.toolCalls as ToolCall[]) {
            send({ type: "tool_start", name: call.function.name });
            const toolResult = await runTool(call.function.name, call.function.arguments, {
              userId,
              emit: send,
              bridge,
            });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.function.name,
              content: JSON.stringify(toolResult).slice(0, 4000),
            });
          }

          if (round === MAX_TOOL_ROUNDS - 1) {
            send({ type: "notice", message: "Tool limit reached for this turn." });
          }
        }

        const assistantMessage = await prisma.message.create({
          data: {
            conversationId: convo.id,
            role: "assistant",
            content: finalText,
            model: usedModel || null,
          },
        });

        await prisma.conversation.updateMany({
          where: { id: convo.id, userId },
          data: { updatedAt: new Date() },
        });

        void recordUsage(userId, "chat", usedModel);

        send({
          type: "done",
          conversationId: convo.id,
          messageId: assistantMessage.id,
          quota: quota.unlimited ? null : { used: quota.used + 1, limit: quota.limit },
        });
        controller.close();

        // After the client has its answer: learn from the exchange and, on the
        // first turn, give the conversation a real title.
        void (async () => {
          try {
            await extractMemories(userId, userText, finalText);
            if (!conversation) {
              const titled = await completeJson<{ title: string }>({
                messages: [
                  {
                    role: "system",
                    content:
                      'Return {"title": "..."} — a 3-6 word title for this exchange. No quotes, no punctuation at the end.',
                  },
                  { role: "user", content: `${userText}\n\n${finalText.slice(0, 500)}` },
                ],
                model: utilityModel(),
                maxTokens: 60,
              });
              if (titled?.title) {
                await prisma.conversation.updateMany({
                  where: { id: convo.id, userId },
                  data: { title: String(titled.title).slice(0, 80) },
                });
              }
            }
          } catch {
            /* best effort */
          }
        })();
      } catch (err) {
        await logEvent("chat", "Turn failed", { detail: err });
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Something went wrong upstream.",
        });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
