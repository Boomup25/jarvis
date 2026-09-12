"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { openSearch } from "./commandBus";
import { SearchIcon, PeopleIcon, LogoutIcon, GearIcon } from "./Icons";
import { SettingsSheet } from "./SettingsSheet";
import type { ChatLayout } from "./ChatView";
import type { VoiceMode } from "./useSpeech";

/**
 * Account actions for the dashboard. Settings stays available here on every
 * viewport, while the sidebar continues to carry the main navigation on wide
 * screens.
 */
export function DashboardHeaderActions({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("natural");
  const [layout, setLayout] = useState<ChatLayout>("presence");
  const [autoListen, setAutoListen] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(true);
  const [soundCues, setSoundCues] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const settings = data?.settings;
        if (!settings) return;
        if (settings.voiceMode === "natural" || settings.voiceMode === "device" || settings.voiceMode === "off") {
          setVoiceMode(settings.voiceMode);
        }
        if (settings.chatLayout === "presence" || settings.chatLayout === "transcript") {
          setLayout(settings.chatLayout);
        }
        if (typeof settings.autoListen === "boolean") setAutoListen(settings.autoListen);
        if (typeof settings.wakeWordEnabled === "boolean") setWakeWordEnabled(settings.wakeWordEnabled);
        if (typeof settings.soundCues === "boolean") setSoundCues(settings.soundCues);
      })
      .catch(() => {});
  }, []);

  function save(patch: Record<string, unknown>) {
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <div className="mb-1 flex items-center justify-end gap-1">
      <button
        onClick={openSearch}
        aria-label="Search everything"
        className="p-2 text-mist transition-colors hover:text-frost"
      >
        <SearchIcon className="size-[18px]" />
      </button>

      {isOwner && (
        <Link
          href="/admin"
          aria-label="People and invites"
          className="p-2 text-mist transition-colors hover:text-frost"
        >
          <PeopleIcon className="size-[18px]" />
        </Link>
      )}

      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="Settings"
        className="p-2 text-mist transition-colors hover:text-frost"
      >
        <GearIcon className="size-[18px]" />
      </button>

      <button
        onClick={signOut}
        aria-label="Sign out"
        className="p-2 text-mist transition-colors hover:text-ember"
      >
        <LogoutIcon className="size-[18px]" />
      </button>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onModelChange={() => {}}
        voiceMode={voiceMode}
        onVoiceModeChange={(next) => {
          setVoiceMode(next);
          save({ voiceMode: next });
        }}
        layout={layout}
        onLayoutChange={(next) => {
          setLayout(next);
          save({ chatLayout: next });
        }}
        autoListen={autoListen}
        onAutoListenChange={(next) => {
          setAutoListen(next);
          save({ autoListen: next });
        }}
        wakeWordEnabled={wakeWordEnabled}
        onWakeWordEnabledChange={(next) => {
          setWakeWordEnabled(next);
          save({ wakeWordEnabled: next });
        }}
        soundCues={soundCues}
        onSoundCuesChange={(next) => {
          setSoundCues(next);
          save({ soundCues: next });
        }}
      />
    </>
  );
}
