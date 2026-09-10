import { guard } from "@/lib/session";
import { getSettings, saveSettings, type Settings } from "@/lib/settings";
import { TTS_VOICES, DEFAULT_VOICE, DEFAULT_INSTRUCTIONS } from "@/lib/tts";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const settings = await getSettings();
  return Response.json({
    settings,
    voices: TTS_VOICES,
    defaults: { voiceId: DEFAULT_VOICE, voiceInstructions: DEFAULT_INSTRUCTIONS },
    ttsConfigured: Boolean(process.env.OPENROUTER_API_KEY),
  });
}

export async function PATCH(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const patch: Settings = {};

  if (typeof body.voiceId === "string") patch.voiceId = body.voiceId;
  if (typeof body.voiceInstructions === "string") patch.voiceInstructions = body.voiceInstructions;
  if (body.voiceMode === "natural" || body.voiceMode === "device" || body.voiceMode === "off") {
    patch.voiceMode = body.voiceMode;
  }

  return Response.json({ settings: await saveSettings(patch) });
}
