import { cookies } from "next/headers";
import { requireUser } from "@/lib/session";
import { rateLimit, clientKey, tooMany } from "@/lib/ratelimit";
import { recordUsage } from "@/lib/users";
import { synthesize } from "@/lib/tts";
import { getSettings } from "@/lib/settings";
import { BRIDGE_COOKIE, isOwnerUser, readUnlockToken } from "@/lib/bridge";
import { bridgeContextFor, runOnMachine } from "@/lib/bridgeTools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Turns text into audio — on your own machine when one is connected, otherwise
 * through the API.
 *
 * Deliberately the same endpoint either way. Everything downstream (the
 * streaming sentence queue, the analyser driving the reactor, the iOS audio
 * unlock) already works against this response, so local speech is a swap here
 * rather than a second pipeline to keep in step. It also means a phone gets
 * the local voice too, since the audio comes back through the server.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;

  // Speech is billed per character, so it gets its own ceiling. Local speech
  // is free but still bounded — it costs the machine's CPU.
  const limit = rateLimit(clientKey(req, `speak:${auth.user.id}`), {
    limit: 120,
    windowMs: 60 * 60_000,
  });
  if (!limit.ok) return tooMany(limit, "Too much speech this hour.");

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim();
  if (!text) return Response.json({ error: "text required" }, { status: 400 });

  const settings = await getSettings(auth.user.id);
  const source = settings.speechSource ?? "auto";

  /* ---- the machine, when it's there and wanted --------------------- */

  if (source !== "cloud" && isOwnerUser(auth.user)) {
    const machine = await speechMachine(auth.user.id, settings.speakNeedsUnlock ?? false);

    if (machine) {
      const outcome = await runOnMachine(machine, "speak", { text });

      if (outcome.ok) {
        const result = outcome.result as { audio?: string; format?: string; engine?: string };
        if (result?.audio) {
          const bytes = Buffer.from(result.audio, "base64");
          void recordUsage(auth.user.id, "speak", `machine:${result.engine ?? "local"}`);
          return new Response(new Uint8Array(bytes), {
            headers: {
              "Content-Type": result.format === "mp3" ? "audio/mpeg" : "audio/wav",
              "Cache-Control": "private, max-age=0, no-store",
              // So the UI can say which voice you're actually hearing.
              "X-Speech-Source": "machine",
              "X-Speech-Engine": String(result.engine ?? "local"),
            },
          });
        }
      }

      // Insisting on the machine means failing loudly rather than quietly
      // spending money on the API instead.
      if (source === "machine") {
        return Response.json(
          { error: outcome.error || "Your machine couldn't produce audio.", source: "machine" },
          { status: 502 }
        );
      }
      // "auto" falls through to the API below.
    } else if (source === "machine") {
      return Response.json(
        { error: "No connected machine to speak with.", source: "machine" },
        { status: 503 }
      );
    }
  }

  /* ---- the API ------------------------------------------------------ */

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
        "X-Speech-Source": "cloud",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Speech synthesis failed" },
      { status: 502 }
    );
  }
}

/**
 * The machine to speak with, if any.
 *
 * Speech is the one capability that doesn't require the 30-minute unlock by
 * default — it reads nothing, writes nothing, and costs nothing, so holding it
 * to the same re-entry as file access would mean the voice dying mid-sentence
 * for no safety gained. It still requires a paired, connected machine owned by
 * this account that advertised the capability, and `speakNeedsUnlock` puts it
 * back behind the passphrase for anyone who'd rather have one rule.
 */
async function speechMachine(userId: string, needsUnlock: boolean) {
  if (needsUnlock) {
    const jar = await cookies();
    const unlockedFor = await readUnlockToken(jar.get(BRIDGE_COOKIE)?.value);
    if (unlockedFor !== userId) return null;
  }

  const machine = await bridgeContextFor(userId);
  if (!machine || !machine.capabilities.includes("speak")) return null;
  return machine;
}
