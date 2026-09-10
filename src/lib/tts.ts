/**
 * Text to speech, through OpenRouter's audio endpoint.
 *
 * Reuses OPENROUTER_API_KEY — no second provider account. The key never
 * reaches the browser; /api/speak proxies and streams the audio back.
 *
 * Note for future me: OpenRouter carries NO OpenAI TTS models, whatever the
 * guide's example says. Every id below was read off
 * /api/v1/models?output_modalities=speech. Check there before adding one.
 */

const BASE = "https://openrouter.ai/api/v1";

export interface VoiceOption {
  /** Stable id used in settings: "<model>::<voice>". */
  id: string;
  model: string;
  voice: string;
  label: string;
  note: string;
  group: "Recommended" | "British" | "Free" | "American";
}

/**
 * Curated, not exhaustive. These models carry their character in the voice
 * itself — there is no "describe the delivery" parameter available here, so
 * voice choice is the whole lever.
 */
export const VOICE_CATALOGUE: VoiceOption[] = [
  {
    id: "mistralai/voxtral-mini-tts-2603::gb_oliver_confident",
    model: "mistralai/voxtral-mini-tts-2603",
    voice: "gb_oliver_confident",
    label: "Oliver — Confident",
    note: "British male, self-assured and level. The closest thing to a butler.",
    group: "Recommended",
  },
  {
    id: "mistralai/voxtral-mini-tts-2603::gb_oliver_neutral",
    model: "mistralai/voxtral-mini-tts-2603",
    voice: "gb_oliver_neutral",
    label: "Oliver — Neutral",
    note: "British male, flatter and more matter-of-fact.",
    group: "Recommended",
  },
  {
    id: "mistralai/voxtral-mini-tts-2603::gb_oliver_curious",
    model: "mistralai/voxtral-mini-tts-2603",
    voice: "gb_oliver_curious",
    label: "Oliver — Curious",
    note: "British male with a touch more lift.",
    group: "British",
  },
  {
    id: "hexgrad/kokoro-82m::bm_george",
    model: "hexgrad/kokoro-82m",
    voice: "bm_george",
    label: "George",
    note: "British male, measured. Cheapest of the paid options.",
    group: "British",
  },
  {
    id: "hexgrad/kokoro-82m::bm_daniel",
    model: "hexgrad/kokoro-82m",
    voice: "bm_daniel",
    label: "Daniel",
    note: "British male, softer.",
    group: "British",
  },
  {
    id: "hexgrad/kokoro-82m::bm_lewis",
    model: "hexgrad/kokoro-82m",
    voice: "bm_lewis",
    label: "Lewis",
    note: "British male, deeper.",
    group: "British",
  },
  {
    id: "hexgrad/kokoro-82m::bm_fable",
    model: "hexgrad/kokoro-82m",
    voice: "bm_fable",
    label: "Fable",
    note: "British male, warmer.",
    group: "British",
  },
  {
    id: "deepgram/flux-tts:free::flux-colin-en",
    model: "deepgram/flux-tts:free",
    voice: "flux-colin-en",
    label: "Colin",
    note: "Free. Natural, mostly American.",
    group: "Free",
  },
  {
    id: "deepgram/flux-tts:free::flux-wes-en",
    model: "deepgram/flux-tts:free",
    voice: "flux-wes-en",
    label: "Wes",
    note: "Free. Lower and calmer.",
    group: "Free",
  },
  {
    id: "deepgram/flux-tts:free::flux-rufus-en",
    model: "deepgram/flux-tts:free",
    voice: "flux-rufus-en",
    label: "Rufus",
    note: "Free. Crisper.",
    group: "Free",
  },
  {
    id: "hexgrad/kokoro-82m::am_onyx",
    model: "hexgrad/kokoro-82m",
    voice: "am_onyx",
    label: "Onyx",
    note: "American male, deep.",
    group: "American",
  },
  {
    id: "hexgrad/kokoro-82m::am_michael",
    model: "hexgrad/kokoro-82m",
    voice: "am_michael",
    label: "Michael",
    note: "American male, even.",
    group: "American",
  },
];

export const DEFAULT_VOICE_ID = "mistralai/voxtral-mini-tts-2603::gb_oliver_confident";

export function resolveVoice(id?: string | null): VoiceOption {
  const wanted = id || process.env.TTS_VOICE_ID || DEFAULT_VOICE_ID;
  return (
    VOICE_CATALOGUE.find((v) => v.id === wanted) ??
    VOICE_CATALOGUE.find((v) => v.id === DEFAULT_VOICE_ID)!
  );
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

export interface SpeakOptions {
  text: string;
  /** A VOICE_CATALOGUE id ("<model>::<voice>"). */
  voiceId?: string;
}

/** Returns the upstream audio response so the route can stream it straight through. */
export async function synthesize(opts: SpeakOptions): Promise<Response> {
  const input = opts.text.trim().slice(0, 4000);
  if (!input) throw new Error("Nothing to speak");

  const primary = resolveVoice(opts.voiceId);
  // Fall back to the free model rather than going silent on a billing problem.
  const chain = [primary, ...VOICE_CATALOGUE.filter((v) => v.group === "Free" && v.id !== primary.id).slice(0, 1)];

  const errors: string[] = [];

  for (const option of chain) {
    const res = await fetch(`${BASE}/audio/speech`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: option.model,
        input,
        voice: option.voice,
        response_format: "mp3",
      }),
    });

    if (res.ok) return res;

    const detail = await res.text().catch(() => "");
    errors.push(`${option.model} → ${res.status} ${detail.slice(0, 240)}`);
  }

  throw new Error(errors.join(" | "));
}
