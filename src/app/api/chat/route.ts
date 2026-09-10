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

import { prisma } from "@/lib/db";
import { guard } from "@/lib/session";
import { buildSystemPrompt } from "@/lib/prompt";
import { streamChat, type ChatMessage, type ToolCall } from "@/lib/openrouter";
import { runTool, toolSchemas } from "@/lib/tools";
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
  const denied = await guard();
  if (denied) return denied;

  let body: { message?: string; conversationId?: string; models?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const userText = String(body.message ?? "").trim();
  if (!userText) return Response.json({ error: "Empty message" }, { status: 400 });

  const conversation = body.conversationId
    ? await prisma.conversation.findUnique({ where: { id: body.conversationId } })
    : null;

  const convo =
    conversation ??
    (await prisma.conversation.create({
      data: { title: userText.slice(0, 60) },
    }));

  await prisma.message.create({
    data: { conversationId: convo.id, role: "user", content: userText },
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
        const matches = await findSimilarPages(userText, { limit: 4 });
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

        const { content: systemPrompt } = await buildSystemPrompt(userText);

        // A model picked in the UI leads; the free chain stays behind it so a
        // rate-limited or retired choice still produces an answer.
        const settings = await getSettings();
        const chain = body.models?.length ? body.models : resolveChain(settings.model);

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

        let finalText = "";
        let usedModel = "";

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const result = await streamChat({
            messages,
            tools: toolSchemas(),
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
            const toolResult = await runTool(call.function.name, call.function.arguments, { emit: send });
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

        await prisma.conversation.update({
          where: { id: convo.id },
          data: { updatedAt: new Date() },
        });

        send({ type: "done", conversationId: convo.id, messageId: assistantMessage.id });
        controller.close();

        // After the client has its answer: learn from the exchange and, on the
        // first turn, give the conversation a real title.
        void (async () => {
          try {
            await extractMemories(userText, finalText);
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
                await prisma.conversation.update({
                  where: { id: convo.id },
                  data: { title: String(titled.title).slice(0, 80) },
                });
              }
            }
          } catch {
            /* best effort */
          }
        })();
      } catch (err) {
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
