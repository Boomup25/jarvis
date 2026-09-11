import { NextRequest } from "next/server";
import { streamChat } from "@/lib/openrouter";
import { clientKey, rateLimit, tooMany } from "@/lib/ratelimit";
import { DEMO_MAX_CHARS, DEMO_MODEL, DEMO_SYSTEM_PROMPT, demoMessage } from "@/lib/demo";

const MAX_BODY_BYTES = 12_000;

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "That message is too large for the demo." }, { status: 413 });
  }

  const limit = rateLimit(clientKey(req, "public-demo"), {
    limit: 8,
    windowMs: 10 * 60_000,
    lockoutMs: 10 * 60_000,
  });
  if (!limit.ok) return tooMany(limit, "The public demo is taking a short break. Try again soon.");

  // Keep a single noisy deployment from turning the public endpoint into an
  // unbounded upstream request source, even when client IP headers vary.
  const globalLimit = rateLimit("public-demo:global", {
    limit: 120,
    windowMs: 10 * 60_000,
    lockoutMs: 60_000,
  });
  if (!globalLimit.ok) return tooMany(globalLimit, "The public demo is busy. Try again soon.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send a message to use the demo." }, { status: 400 });
  }

  const message = demoMessage((body as { message?: unknown } | null)?.message);
  if (!message) return Response.json({ error: "Send a message to use the demo." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // A visitor may close the tab while the model is still streaming.
          closed = true;
        }
      };

      try {
        await streamChat({
          messages: [
            { role: "system", content: DEMO_SYSTEM_PROMPT },
            { role: "user", content: message },
          ],
          // Keep the demo on one known free model. _rediscovered prevents the
          // general client from silently falling back to another model.
          models: [DEMO_MODEL],
          _rediscovered: true,
          temperature: 0.5,
          maxTokens: 500,
          signal: req.signal,
          onDelta: (delta) => send({ type: "text", delta }),
        });
        send({ type: "done" });
      } catch {
        // Never expose OpenRouter errors, request details, or environment data.
        send({ type: "error", message: "The demo is temporarily unavailable. Please try again later." });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // The client may have cancelled the stream between chunks.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
