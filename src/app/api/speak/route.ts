import { guard } from "@/lib/session";
import { synthesize } from "@/lib/tts";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Proxies TTS so the API key stays server-side, and streams the audio back. */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim();
  if (!text) return Response.json({ error: "text required" }, { status: 400 });

  const settings = await getSettings();

  try {
    const upstream = await synthesize({
      text,
      voice: body.voice || settings.voiceId,
      instructions: settings.voiceInstructions,
    });

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Speech synthesis failed" },
      { status: 502 }
    );
  }
}
