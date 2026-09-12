import { requireUser } from "@/lib/session";
import { getSettings, saveSettings, type Settings } from "@/lib/settings";
import { VOICE_CATALOGUE, DEFAULT_VOICE_ID } from "@/lib/tts";
import { isOwnerUser } from "@/lib/bridge";
import { bridgeContextFor } from "@/lib/bridgeTools";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  const settings = await getSettings(auth.user.id);

  // So the panel can say whether local speech is actually available rather
  // than offering an option that would silently fall back.
  const machine = isOwnerUser(auth.user) ? await bridgeContextFor(auth.user.id) : null;

  return Response.json({
    settings,
    speechMachine:
      machine && machine.capabilities.includes("speak")
        ? { name: machine.deviceName, engine: "local" }
        : null,
    voices: VOICE_CATALOGUE,
    defaults: { voiceId: DEFAULT_VOICE_ID },
    ttsConfigured: Boolean(process.env.OPENROUTER_API_KEY),
  });
}

export async function PATCH(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;

  const body = await req.json().catch(() => ({}));
  const patch: Settings = {};

  if (typeof body.voiceId === "string") patch.voiceId = body.voiceId;
  if (typeof body.voiceInstructions === "string") patch.voiceInstructions = body.voiceInstructions;
  if (body.voiceMode === "natural" || body.voiceMode === "device" || body.voiceMode === "off") {
    patch.voiceMode = body.voiceMode;
  }

  if (body.chatLayout === "presence" || body.chatLayout === "transcript") {
    patch.chatLayout = body.chatLayout;
  }
  if (typeof body.autoListen === "boolean") patch.autoListen = body.autoListen;
  if (typeof body.wakeWordEnabled === "boolean") patch.wakeWordEnabled = body.wakeWordEnabled;
  if (body.speechSource === "auto" || body.speechSource === "cloud" || body.speechSource === "machine") {
    patch.speechSource = body.speechSource;
  }
  if (typeof body.speakNeedsUnlock === "boolean") patch.speakNeedsUnlock = body.speakNeedsUnlock;
  if (typeof body.soundCues === "boolean") patch.soundCues = body.soundCues;

  if (typeof body.pushEnabled === "boolean") patch.pushEnabled = body.pushEnabled;
  if (typeof body.briefHour === "number") patch.briefHour = Math.min(23, Math.max(0, body.briefHour));
  if (typeof body.quietFrom === "number") patch.quietFrom = Math.min(23, Math.max(0, body.quietFrom));
  if (typeof body.quietTo === "number") patch.quietTo = Math.min(23, Math.max(0, body.quietTo));
  if (Array.isArray(body.mutedKinds)) patch.mutedKinds = body.mutedKinds.map(String).slice(0, 10);
  if (typeof body.lat === "number" && typeof body.lon === "number") {
    patch.lat = body.lat;
    patch.lon = body.lon;
  }

  return Response.json({ settings: await saveSettings(auth.user.id, patch) });
}
