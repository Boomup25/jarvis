import { requireUser } from "@/lib/session";
import { rateLimit, clientKey, tooMany } from "@/lib/ratelimit";
import { recordUsage } from "@/lib/users";
import { synthesize } from "@/lib/tts";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Proxies TTS so the API key stays server-side, and streams the audio back. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;

  // Speech is billed per character, so it gets its own ceiling.
  const limit = rateLimit(clientKey(req, `speak:${auth.user.id}`), {
    limit: 120,
    windowMs: 60 * 60_000,
  });
  if (!limit.ok) return tooMany(limit, "Too much speech this hour.");

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim();
  if (!text) return Response.json({ error: "text required" }, { status: 400 });

  const settings = await getSettings(auth.user.id);

  try {
    const upstream = await synthesize({
      text,
      voiceId: body.voiceId || settings.voiceId,
    });

    void recordUsage(auth.user.id, "speak");

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
