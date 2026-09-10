/**
 * Model selection.
 *
 * OpenRouter's free tier rotates fast — models that worked six months ago are
 * routinely gone. So this is layered:
 *   1. OPENROUTER_MODELS env var, if you set one (full control)
 *   2. The known-good chain below
 *   3. Live discovery from OpenRouter's catalogue, if 1 and 2 both fail
 *
 * Layer 3 is what stops a dead hardcoded list from bricking the app.
 */

/** Verified against OpenRouter's catalogue — all support tool calling. */
export const FREE_MODEL_CHAIN = [
  "nex-agi/nex-n2.5-pro:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nex-agi/nex-n2.5-mini:free",
  "dots-studio/dots-3-note-preview:free",
];

/** Once you add credits, drop one of these into OPENROUTER_MODELS. */
export const PAID_SUGGESTIONS = [
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-4.1-mini",
  "google/gemini-2.5-flash",
];

export function modelChain(): string[] {
  const raw = process.env.OPENROUTER_MODELS?.trim();
  if (raw) {
    const list = raw.split(",").map((m) => m.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return FREE_MODEL_CHAIN;
}

/** Small/cheap model for background work: memory extraction, titles. */
export function utilityModel(): string {
  return process.env.OPENROUTER_UTILITY_MODEL?.trim() || "nex-agi/nex-n2.5-mini:free";
}

/**
 * The chain to actually use for a chat turn.
 * A model the user picked in the UI goes first; the free chain stays behind it
 * as a safety net so a dead or rate-limited choice doesn't kill the turn.
 */
export function resolveChain(selected?: string | null): string[] {
  const base = modelChain();
  if (!selected) return base;
  return [selected, ...base.filter((m) => m !== selected)];
}

/** Display names for the providers worth surfacing first in the picker. */
export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  "z-ai": "Z.AI (GLM)",
  zhipuai: "Zhipu (GLM)",
  google: "Google",
  "x-ai": "xAI",
  deepseek: "DeepSeek",
  "meta-llama": "Meta",
  qwen: "Qwen",
  mistralai: "Mistral",
  nvidia: "NVIDIA",
  cohere: "Cohere",
  "nex-agi": "Nex AGI",
  perplexity: "Perplexity",
  amazon: "Amazon",
  microsoft: "Microsoft",
};

/** Providers pinned to the top of the dropdown, in this order. */
export const PINNED_PROVIDERS = [
  "openai",
  "anthropic",
  "z-ai",
  "zhipuai",
  "google",
  "deepseek",
  "x-ai",
  "meta-llama",
  "qwen",
  "mistralai",
];
