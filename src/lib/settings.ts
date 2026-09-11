/**
 * Per-user settings that live in Profile.data, so adding one needs no migration.
 */

import type { Prisma } from "@prisma/client";
import { prisma, getProfile } from "./db";

export interface Settings {
  /** OpenRouter model id the user picked in the UI. Empty = use the default chain. */
  model?: string;
  /** "natural" = the TTS API, "device" = the browser voice, "off" = silent. */
  voiceMode?: "natural" | "device" | "off";
  /** Voice id for the TTS API. */
  voiceId?: string;
  /** Overrides the delivery description in src/lib/tts.ts. */
  voiceInstructions?: string;

  // ---- proactive notifications ----
  pushEnabled?: boolean;
  /** Local hour (0-23) the morning brief goes out. */
  briefHour?: number;
  /** Quiet window, local hours. Wraps midnight when from > to. */
  quietFrom?: number;
  quietTo?: number;
  /** Notification kinds to suppress. */
  mutedKinds?: string[];
  /** For weather. Set from the browser, or left unset to skip weather entirely. */
  lat?: number;
  lon?: number;
}

export async function getSettings(userId: string): Promise<Settings> {
  const profile = await getProfile(userId);
  const data = (profile.data ?? {}) as Record<string, unknown>;
  return {
    model: typeof data.model === "string" && data.model ? data.model : undefined,
    voiceMode:
      data.voiceMode === "natural" || data.voiceMode === "device" || data.voiceMode === "off"
        ? data.voiceMode
        : undefined,
    voiceId: typeof data.voiceId === "string" && data.voiceId ? data.voiceId : undefined,
    voiceInstructions:
      typeof data.voiceInstructions === "string" && data.voiceInstructions
        ? data.voiceInstructions
        : undefined,
    pushEnabled: typeof data.pushEnabled === "boolean" ? data.pushEnabled : undefined,
    briefHour: typeof data.briefHour === "number" ? data.briefHour : undefined,
    quietFrom: typeof data.quietFrom === "number" ? data.quietFrom : undefined,
    quietTo: typeof data.quietTo === "number" ? data.quietTo : undefined,
    mutedKinds: Array.isArray(data.mutedKinds) ? (data.mutedKinds as string[]) : undefined,
    lat: typeof data.lat === "number" ? data.lat : undefined,
    lon: typeof data.lon === "number" ? data.lon : undefined,
  };
}

/** Merges into Profile.data rather than replacing it. */
export async function saveSettings(userId: string, patch: Settings): Promise<Settings> {
  const profile = await getProfile(userId);
  const data = { ...((profile.data ?? {}) as Record<string, unknown>) };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === "" || value === null) delete data[key];
    else data[key] = value;
  }

  await prisma.profile.update({
    where: { userId },
    data: { data: data as Prisma.InputJsonObject },
  });
  return getSettings(userId);
}
