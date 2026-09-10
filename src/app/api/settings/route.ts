import { guard } from "@/lib/session";
import { getSettings, saveSettings, type Settings } from "@/lib/settings";
import { VOICE_CATALOGUE, DEFAULT_VOICE_ID } from "@/lib/tts";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const settings = await getSettings();
  return Response.json({
    settings,
    voices: VOICE_CATALOGUE,
    defaults: { voiceId: DEFAULT_VOICE_ID },
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
