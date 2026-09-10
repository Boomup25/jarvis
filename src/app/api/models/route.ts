import { guard } from "@/lib/session";
import { listModels, isFree, supportsTools, type OpenRouterModel } from "@/lib/openrouter";
import { modelChain, PROVIDER_LABELS, PINNED_PROVIDERS } from "@/lib/models";
import { getSettings, saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export interface PickerModel {
  id: string;
  name: string;
  provider: string;
  context: number;
  /** USD per million tokens. 0 means free. */
  inputPrice: number;
  outputPrice: number;
  free: boolean;
  tools: boolean;
}

const perMillion = (raw: string | undefined) => Math.round(Number(raw ?? 0) * 1_000_000 * 100) / 100;

function toPicker(m: OpenRouterModel): PickerModel {
  return {
    id: m.id,
    name: m.name?.replace(/\s*\(free\)\s*$/i, "") ?? m.id,
    provider: m.id.split("/")[0] ?? "other",
    context: m.context_length ?? 0,
    inputPrice: perMillion(m.pricing?.prompt),
    outputPrice: perMillion(m.pricing?.completion),
    free: isFree(m),
    tools: supportsTools(m),
  };
}

/**
 * Everything the model dropdown needs, pulled live.
 *
 * Deliberately not a hardcoded list: OpenRouter retires model ids constantly,
 * and a stale hardcoded chain is exactly what broke this app once already.
 */
export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const settings = await getSettings();
  const chain = modelChain();

  try {
    const all = await listModels();

    const usable = all
      .filter((m) => !/\b(batch|embedding|moderation|whisper|tts|clip|lyria)\b/i.test(m.id))
      .map(toPicker)
      .filter((m) => m.context > 0);

    const byProvider = new Map<string, PickerModel[]>();
    for (const model of usable) {
      const list = byProvider.get(model.provider) ?? [];
      list.push(model);
      byProvider.set(model.provider, list);
    }

    const order = (provider: string) => {
      const pinned = PINNED_PROVIDERS.indexOf(provider);
      return pinned === -1 ? PINNED_PROVIDERS.length : pinned;
    };

    const groups = [...byProvider.entries()]
      .map(([provider, models]) => ({
        provider,
        label: PROVIDER_LABELS[provider] ?? provider,
        models: models.sort((a, b) => b.inputPrice - a.inputPrice || a.name.localeCompare(b.name)),
      }))
      .sort(
        (a, b) => order(a.provider) - order(b.provider) || a.label.localeCompare(b.label)
      );

    const free = usable
      .filter((m) => m.free && m.tools)
      .sort((a, b) => b.context - a.context);

    return Response.json({
      current: settings.model ?? null,
      chain,
      stale: chain.filter((id) => !all.some((m) => m.id === id)),
      free,
      groups,
      count: usable.length,
    });
  } catch (err) {
    return Response.json({
      current: settings.model ?? null,
      chain,
      stale: [],
      free: [],
      groups: [],
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Save the picked model. Empty string clears it back to the default chain. */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  if (typeof body.model !== "string") {
    return Response.json({ error: "model must be a string" }, { status: 400 });
  }

  const settings = await saveSettings({ model: body.model.trim() });
  return Response.json({ current: settings.model ?? null });
}
