/**
 * Text to speech, through OpenRouter's audio endpoint.
 *
 * Reuses OPENROUTER_API_KEY — no second provider account. The key never
 * reaches the browser; /api/speak proxies and streams the audio back.
 */

const BASE = "https://openrouter.ai/api/v1";

/** Voices available on gpt-4o-mini-tts. */
export const TTS_VOICES = [
  { id: "onyx", label: "Onyx", note: "Deep, level — the closest to a butler" },
  { id: "ballad", label: "Ballad", note: "Measured and warm" },
  { id: "ash", label: "Ash", note: "Dry, understated" },
  { id: "sage", label: "Sage", note: "Calm, considered" },
  { id: "echo", label: "Echo", note: "Neutral, clipped" },
  { id: "fable", label: "Fable", note: "Expressive, storyteller" },
  { id: "verse", label: "Verse", note: "Light, conversational" },
  { id: "alloy", label: "Alloy", note: "Plain and even" },
  { id: "cedar", label: "Cedar", note: "Soft-spoken" },
  { id: "marin", label: "Marin", note: "Bright" },
  { id: "coral", label: "Coral", note: "Brisk" },
  { id: "nova", label: "Nova", note: "Higher, energetic" },
  { id: "shimmer", label: "Shimmer", note: "Airy" },
] as const;

export const DEFAULT_VOICE = "onyx";

/**
 * This is where the character actually lives. gpt-4o-mini-tts performs a
 * described delivery rather than just applying an accent, so the wording here
 * matters more than the voice choice does.
 */
export const DEFAULT_INSTRUCTIONS =
  "Speak with a refined British accent, in the manner of a composed, highly capable butler. " +
  "Unhurried and level. Understated confidence, never eager, never cheerful. " +
  "Slight downward inflection at the end of sentences. Dry wit delivered flat, without emphasis. " +
  "Treat everything as entirely under control.";

export function ttsModel(): string {
  return process.env.TTS_MODEL?.trim() || "openai/gpt-4o-mini-tts";
}

function headers() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_SITE_NAME || "JARVIS",
  };
}

let discovered: { at: number; models: string[] } | null = null;

/** Same self-healing trick as the chat chain — model ids get retired. */
async function discoverTtsModels(): Promise<string[]> {
  if (discovered && Date.now() - discovered.at < 30 * 60 * 1000) return discovered.models;
  try {
    const res = await fetch(`${BASE}/models?output_modalities=speech`, { headers: headers() });
    if (!res.ok) return [];
    const json = await res.json();
    const models: string[] = (json.data ?? [])
      .map((m: { id: string }) => m.id)
      .filter(Boolean)
      // Prefer OpenAI's, which is the one that honours `instructions`.
      .sort((a: string, b: string) => Number(b.startsWith("openai/")) - Number(a.startsWith("openai/")));
    discovered = { at: Date.now(), models };
    return models;
  } catch {
    return [];
  }
}

export interface SpeakOptions {
  text: string;
  voice?: string;
  instructions?: string;
  speed?: number;
}

/** Returns the upstream audio response so the route can stream it straight through. */
export async function synthesize(opts: SpeakOptions): Promise<Response> {
  const input = opts.text.trim().slice(0, 4000);
  if (!input) throw new Error("Nothing to speak");

  const voice = TTS_VOICES.some((v) => v.id === opts.voice) ? opts.voice! : DEFAULT_VOICE;
  const instructions = opts.instructions?.trim() || DEFAULT_INSTRUCTIONS;

  const attempt = async (model: string) =>
    fetch(`${BASE}/audio/speech`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model,
        input,
        voice,
        response_format: "mp3",
        speed: opts.speed ?? 1.0,
        provider: { options: { openai: { instructions } } },
      }),
    });

  const primary = ttsModel();
  let res = await attempt(primary);
  if (res.ok) return res;

  for (const model of (await discoverTtsModels()).filter((m) => m !== primary).slice(0, 3)) {
    res = await attempt(model);
    if (res.ok) return res;
  }

  const detail = await res.text().catch(() => "");
  throw new Error(`TTS failed (${res.status}) ${detail.slice(0, 200)}`);
}
