/**
 * Minimal OpenRouter client.
 *
 * Two entry points:
 *   streamChat()   — SSE streaming with OpenAI-style tool-call deltas
 *   completeJson() — one-shot call that coerces the reply into JSON
 *
 * Both walk a fallback chain of models: free models rate-limit constantly,
 * so if one 429s or errors we transparently try the next.
 */

import { modelChain } from "./models";

const BASE = "https://openrouter.ai/api/v1";

export type Role = "system" | "user" | "assistant" | "tool";

/** A multimodal content part. Text-only turns still pass a plain string. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function headers() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set. Add it to .env");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_SITE_NAME || "JARVIS",
  };
}

export interface StreamResult {
  /** Full assistant text for this round. */
  text: string;
  /** Tool calls the model wants executed, if any. */
  toolCalls: ToolCall[];
  /** Which model actually answered. */
  model: string;
  finishReason: string | null;
}

/**
 * Streams one assistant round. Calls onDelta for each text chunk.
 * Returns once the round finishes (either plain text or tool_calls).
 */
export async function streamChat(opts: {
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  models?: string[];
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onModel?: (model: string) => void;
  /** Internal: prevents the discovery fallback from looping. */
  _rediscovered?: boolean;
}): Promise<StreamResult> {
  const chain = opts.models?.length ? opts.models : modelChain();
  let lastError: unknown = null;

  for (const model of chain) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: headers(),
        signal: opts.signal,
        body: JSON.stringify({
          model,
          messages: opts.messages,
          stream: true,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 2000,
          ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        lastError = new Error(`${model} -> ${res.status} ${body.slice(0, 300)}`);
        // 4xx that isn't rate limiting usually means the model rejected our
        // request shape (e.g. no tool support) — try the next one either way.
        continue;
      }

      opts.onModel?.(model);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let finishReason: string | null = null;
      const toolAcc = new Map<number, ToolCall>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;

          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = parsed.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;

          const delta = choice.delta;
          if (!delta) continue;

          if (typeof delta.content === "string" && delta.content.length) {
            text += delta.content;
            opts.onDelta(delta.content);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx: number = tc.index ?? 0;
              const acc =
                toolAcc.get(idx) ??
                { id: tc.id || `call_${idx}`, type: "function" as const, function: { name: "", arguments: "" } };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.function.name += tc.function.name;
              if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
              toolAcc.set(idx, acc);
            }
          }
        }
      }

      const toolCalls = [...toolAcc.values()].filter((t) => t.function.name);
      if (!text.trim() && toolCalls.length === 0) {
        lastError = new Error(`${model} returned an empty response`);
        continue;
      }

      return { text, toolCalls, model, finishReason };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastError = err;
    }
  }

  // The configured chain is exhausted. Before giving up, find out what is
  // actually free and tool-capable today and try those.
  if (!opts._rediscovered) {
    const discovered = (await discoverFreeModels()).filter((m) => !chain.includes(m));
    if (discovered.length) {
      return streamChat({ ...opts, models: discovered, _rediscovered: true });
    }
  }

  throw new Error(
    `Every model failed. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/** Non-streaming call whose reply is parsed as JSON. Returns null on failure. */
export async function completeJson<T>(opts: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
}): Promise<T | null> {
  const chain = opts.model ? [opts.model] : modelChain().slice(0, 2);
  for (const model of chain) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          model,
          messages: opts.messages,
          temperature: 0.1,
          max_tokens: opts.maxTokens ?? 800,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const content: string = json.choices?.[0]?.message?.content ?? "";
      const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const start = cleaned.search(/[[{]/);
      if (start < 0) continue;
      return JSON.parse(cleaned.slice(start)) as T;
    } catch {
      continue;
    }
  }
  return null;
}

export interface Citation {
  url: string;
  title: string;
}

export interface WebSearchResult {
  answer: string;
  citations: Citation[];
}

/**
 * One web-grounded question, answered.
 *
 * OpenRouter's web plugin is a per-REQUEST option, not a per-tool one — so
 * enabling it globally would bill a search on every single message. Instead
 * this runs as its own call, triggered only when the model decides it needs
 * facts it doesn't have. Roughly $0.007 a search.
 */
export async function webSearch(query: string, maxResults = 5): Promise<WebSearchResult> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: process.env.OPENROUTER_SEARCH_MODEL?.trim() || modelChain()[0],
      plugins: [{ id: "web", max_results: maxResults }],
      max_tokens: 900,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Answer the question using the search results. Be specific and include " +
            "numbers, dates and names. State plainly when sources disagree or when " +
            "the answer is uncertain. Do not pad.",
        },
        { role: "user", content: query },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Search failed (${res.status}) ${detail.slice(0, 200)}`);
  }

  const json = await res.json();
  const message = json.choices?.[0]?.message ?? {};
  const citations: Citation[] = (message.annotations ?? [])
    .filter((a: { type?: string }) => a?.type === "url_citation")
    .map((a: { url_citation: Citation }) => ({
      url: a.url_citation?.url,
      title: a.url_citation?.title,
    }))
    .filter((c: Citation) => Boolean(c.url));

  return { answer: String(message.content ?? ""), citations };
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  input_modalities?: string[];
}

/** Models that accept image input. The field moved into `architecture` at some
 *  point, so check both rather than assume. */
export function supportsVision(model: OpenRouterModel): boolean {
  const modalities = model.architecture?.input_modalities ?? model.input_modalities ?? [];
  return modalities.includes("image");
}

let visionCache: { at: number; models: string[] } | null = null;

/** Free/cheap models that can read an image, newest cache within 30 minutes. */
export async function discoverVisionModels(): Promise<string[]> {
  if (visionCache && Date.now() - visionCache.at < 30 * 60 * 1000) return visionCache.models;
  try {
    const all = await listModels();
    const models = all
      .filter(supportsVision)
      .sort((a, b) => Number(isFree(b)) - Number(isFree(a)))
      .map((m) => m.id)
      .slice(0, 8);
    visionCache = { at: Date.now(), models };
    return models;
  } catch {
    return [];
  }
}

/** Live model catalogue, so the settings page never shows a dead free model. */
export async function listModels(): Promise<OpenRouterModel[]> {
  const res = await fetch(`${BASE}/models`, { headers: headers(), next: { revalidate: 3600 } });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data ?? []) as OpenRouterModel[];
}

export function isFree(model: OpenRouterModel): boolean {
  return (
    model.id.endsWith(":free") ||
    (Number(model.pricing?.prompt ?? 1) === 0 && Number(model.pricing?.completion ?? 1) === 0)
  );
}

export function supportsTools(model: OpenRouterModel): boolean {
  return model.supported_parameters?.includes("tools") ?? false;
}

let discoveryCache: { at: number; models: string[] } | null = null;
const DISCOVERY_TTL = 30 * 60 * 1000;

/**
 * Last resort: ask OpenRouter what is free and tool-capable *right now*.
 * Free model IDs get retired regularly, so a hardcoded chain eventually dies —
 * this is what keeps the app alive when that happens.
 */
export async function discoverFreeModels(): Promise<string[]> {
  if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL) {
    return discoveryCache.models;
  }
  try {
    const all = await listModels();
    const models = all
      .filter((m) => isFree(m) && supportsTools(m))
      .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
      .map((m) => m.id)
      .slice(0, 6);
    discoveryCache = { at: Date.now(), models };
    return models;
  } catch {
    return [];
  }
}
