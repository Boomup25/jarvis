/**
 * Per-user settings that live in Profile.data, so adding one needs no migration.
 */

import type { Prisma } from "@prisma/client";
import { prisma, getProfile, PROFILE_ID } from "./db";

export interface Settings {
  /** OpenRouter model id the user picked in the UI. Empty = use the default chain. */
  model?: string;
}

export async function getSettings(): Promise<Settings> {
  const profile = await getProfile();
  const data = (profile.data ?? {}) as Record<string, unknown>;
  return {
    model: typeof data.model === "string" && data.model ? data.model : undefined,
  };
}

/** Merges into Profile.data rather than replacing it. */
export async function saveSettings(patch: Settings): Promise<Settings> {
  const profile = await getProfile();
  const data = { ...((profile.data ?? {}) as Record<string, unknown>) };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === "" || value === null) delete data[key];
    else data[key] = value;
  }

  await prisma.profile.update({
    where: { id: PROFILE_ID },
    data: { data: data as Prisma.InputJsonObject },
  });
  return getSettings();
}
