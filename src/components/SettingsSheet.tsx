"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CheckIcon, SearchIcon, MicIcon, SparkIcon } from "./Icons";
import { NotificationSettings } from "./NotificationSettings";
import { BridgePanel } from "./BridgePanel";
import { DEFAULT_SILENCE_MS, readSilenceMs, writeSilenceMs, type VoiceMode } from "./useSpeech";
import type { ChatLayout } from "./ChatView";

interface PickerModel {
  id: string;
  name: string;
  provider: string;
  context: number;
  inputPrice: number;
  outputPrice: number;
  free: boolean;
  tools: boolean;
}

interface Group {
  provider: string;
  label: string;
  models: PickerModel[];
}

interface CatalogueResponse {
  current: string | null;
  chain: string[];
  stale: string[];
  free: PickerModel[];
  groups: Group[];
  count: number;
  error?: string;
}

interface Voice {
  id: string;
  model: string;
  voice: string;
  label: string;
  note: string;
  group: string;
}

export function SettingsSheet({
  open,
  onClose,
  onModelChange,
  voiceMode,
  onVoiceModeChange,
  layout,
  onLayoutChange,
  autoListen,
  onAutoListenChange,
  wakeWordEnabled,
  onWakeWordEnabledChange,
}: {
  open: boolean;
  onClose: () => void;
  onModelChange: (id: string | null) => void;
  voiceMode: VoiceMode;
  onVoiceModeChange: (mode: VoiceMode) => void;
  layout: ChatLayout;
  onLayoutChange: (layout: ChatLayout) => void;
  autoListen: boolean;
  onAutoListenChange: (on: boolean) => void;
  wakeWordEnabled: boolean;
  onWakeWordEnabledChange: (on: boolean) => void;
}) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [savingVoice, setSavingVoice] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [data, setData] = useState<CatalogueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [silence, setSilence] = useState(DEFAULT_SILENCE_MS);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; pointerId: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || voices.length) return;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        setVoices(json.voices ?? []);
        setVoiceId(json.settings?.voiceId ?? json.defaults?.voiceId ?? "");
      })
      .catch(() => {});
  }, [open, voices.length]);

  useEffect(() => {
    if (!open) return;
    setSilence(readSilenceMs());
    if (data) return;
    setLoading(true);
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setData(json))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const groups = useMemo(() => {
    if (!data?.groups) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.groups;
    return data.groups
      .map((g) => ({
        ...g,
        models: g.models.filter(
          (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.models.length > 0);
  }, [data, query]);

  async function pick(id: string | null) {
    setSaving(id ?? "auto");
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id ?? "" }),
      });
      if (res.ok) {
        const { current } = await res.json();
        setData((prev) => (prev ? { ...prev, current } : prev));
        onModelChange(current);
        onClose();
      }
    } finally {
      setSaving(null);
    }
  }

  async function saveVoice(patch: Record<string, string>) {
    setSavingVoice(true);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } finally {
      setSavingVoice(false);
    }
  }

  async function preview() {
    setPreviewing(true);
    try {
      await saveVoice({ voiceId });
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Good evening. Everything is in order, and your schedule is clear.",
          voiceId,
        }),
      });
      if (!res.ok) throw new Error("preview failed");
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      /* the sheet stays usable; the chat surfaces real failures */
    } finally {
      setPreviewing(false);
    }
  }

  function updateSilence(ms: number) {
    setSilence(ms);
    writeSilenceMs(ms);
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = { startY: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    setDragOffset(Math.max(0, event.clientY - dragRef.current.startY));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const shouldClose = dragOffset > 110;
    dragRef.current = null;
    setDragging(false);
    setDragOffset(0);
    if (shouldClose) onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end lg:items-center lg:justify-center lg:p-8">
      <button
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 bg-void/70 backdrop-blur-sm"
      />

      {/* One scroll container for the whole sheet. It used to have a shrink-0
          header that new sections kept getting added to, which made them
          unreachable — nothing to scroll them into view. */}
      <div
        className="relative flex max-h-[88dvh] w-full flex-col overflow-y-auto overscroll-contain border-t border-edge glass safe-bottom lg:max-w-3xl lg:rounded-xl lg:border"
        style={{
          transform: `translateY(${dragOffset}px)`,
          transition: dragging ? "none" : "transform 180ms ease-out",
        }}
      >
        <div className="border-b border-edge px-4 pb-3 pt-3">
          <div
            role="button"
            tabIndex={0}
            aria-label="Drag down to close settings"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Enter" || event.key === " ") onClose();
            }}
            className="mx-auto mb-3 flex h-5 w-12 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          >
            <span className="h-1 w-9 rounded-full bg-edge" />
          </div>

          <div className="mb-3">
            <NotificationSettings />
          </div>

          <PasswordSection />

          {/* Owner-only and behind its own passphrase; the component renders
              nothing at all for an account that can't reach the bridge. */}
          <BridgePanel />

          <section className="mb-3">
            <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-mist">
              <SparkIcon className="size-3.5" />
              The JARVIS page
            </div>

            <div className="mt-2 flex gap-1.5">
              {(
                [
                  ["presence", "Presence", "Reactor centre stage, live captions"],
                  ["transcript", "Transcript", "Reactor above a scrolling history"],
                ] as [ChatLayout, string, string][]
              ).map(([value, label, note]) => (
                <button
                  key={value}
                  onClick={() => onLayoutChange(value)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-left transition-colors ${
                    layout === value ? "border-arc/50 bg-arc/10 text-arc" : "border-edge text-mist"
                  }`}
                >
                  <span className="block text-[0.75rem]">{label}</span>
                  <span className="mt-0.5 block text-[0.62rem] leading-snug opacity-70">{note}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => onAutoListenChange(!autoListen)}
              role="switch"
              aria-checked={autoListen}
              className="mt-2 flex w-full items-center gap-3 rounded-lg border border-edge px-3 py-2.5 text-left transition-colors hover:border-arc/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8rem]">Listen as soon as I open it</span>
                <span className="mt-0.5 block text-[0.65rem] leading-snug text-mist">
                  {autoListen
                    ? wakeWordEnabled ? 'Waits for “Hey Jarvis” when the page opens.' : "The reactor starts listening on load."
                    : "Tap the reactor to start a conversation."}
                </span>
              </span>
              <span
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  autoListen ? "bg-arc" : "bg-edge"
                }`}
              >
                <span
                  className={`absolute top-0.5 size-4 rounded-full bg-void transition-all ${
                    autoListen ? "left-[1.125rem]" : "left-0.5"
                  }`}
                />
              </span>
            </button>
          </section>

          <section className="mb-3">
            <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-mist">
              <MicIcon className="size-3.5" />
              Voice
            </div>
            <button
              onClick={() => onWakeWordEnabledChange(!wakeWordEnabled)}
              role="switch"
              aria-checked={wakeWordEnabled}
              className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg border border-edge px-3 py-2.5 text-left hover:border-arc/40"
            >
              <span>
                <span className="block text-[0.8rem]">Wait for “Hey Jarvis” between conversations</span>
                <span className="mt-0.5 block text-[0.65rem] leading-snug text-mist">
                  Say goodbye or leave 30 seconds of quiet to finish. Follow-up questions need no wake phrase.
                </span>
              </span>
              <span className={wakeWordEnabled ? "text-arc" : "text-mist"}>{wakeWordEnabled ? "On" : "Off"}</span>
            </button>
            <p className="mt-1.5 text-[0.65rem] leading-snug text-mist">
              Waiting keeps the microphone on while this page is open. Tap the mic or press Escape to turn it off.
              Your browser may use an online speech recognition service.
            </p>
            <div className="mt-2 flex gap-1.5">
              {(["natural", "device"] as VoiceMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => onVoiceModeChange(m)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-[0.72rem] transition-colors ${
                    voiceMode === m ? "border-arc/50 bg-arc/10 text-arc" : "border-edge text-mist"
                  }`}
                >
                  {m === "natural" ? "Natural voice" : "Device voice"}
                </button>
              ))}
            </div>

            {voiceMode === "natural" && <SpeechSource />}

            {voiceMode === "natural" && (
              <div className="mt-2.5 space-y-2">
                <label className="block">
                  <span className="text-[0.7rem] text-mist">Voice</span>
                  <select
                    value={voiceId}
                    onChange={(e) => {
                      setVoiceId(e.target.value);
                      void saveVoice({ voiceId: e.target.value });
                    }}
                    className="mt-1 w-full rounded-lg border border-edge bg-abyss/70 px-2.5 py-2 text-[0.8rem] focus:border-arc/50 focus:outline-none"
                  >
                    {["Recommended", "British", "Free", "American"].map((group) => {
                      const inGroup = voices.filter((v) => v.group === group);
                      if (!inGroup.length) return null;
                      return (
                        <optgroup key={group} label={group}>
                          {inGroup.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <span className="mt-1 block text-[0.65rem] leading-snug text-mist">
                    {voices.find((v) => v.id === voiceId)?.note ??
                      "British voices carry the character best."}
                  </span>
                </label>

                <button
                  onClick={preview}
                  disabled={previewing || savingVoice}
                  className="w-full rounded-lg border border-edge py-2 text-[0.75rem] text-mist transition-colors hover:text-frost disabled:opacity-50"
                >
                  {previewing ? "Speaking…" : "Preview"}
                </button>
              </div>
            )}

            <label className="mt-3 block">
              <div className="flex items-baseline justify-between">
                <span className="text-[0.8rem]">Pause before sending</span>
                <span className="font-mono text-[0.78rem] text-arc">{(silence / 1000).toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min={1000}
                max={6000}
                step={250}
                value={silence}
                onChange={(e) => updateSilence(Number(e.target.value))}
                className="mt-1.5 w-full accent-[var(--color-arc)]"
              />
              <p className="mt-1 text-[0.68rem] leading-snug text-mist">
                How long you can go quiet mid-sentence before it decides you&apos;re done.
                Raise it if it keeps cutting you off.
              </p>
            </label>
          </section>

          <button
            type="button"
            onClick={() => setModelsOpen((open) => !open)}
            aria-expanded={modelsOpen}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-mist">
              AI models
            </span>
            <span className="flex min-w-0 items-center gap-2 text-[0.7rem] text-mist">
              <span className="truncate">{data?.current ? data.current.split("/").pop() : "Automatic"}</span>
              <span className="text-arc">{modelsOpen ? "−" : "+"}</span>
            </span>
          </button>

          {!modelsOpen && (
            <p className="mt-1 text-[0.65rem] text-mist">
              Choose the model JARVIS uses for replies.
            </p>
          )}

        {modelsOpen && <>
          <div className="relative mt-2 px-4">
            <SearchIcon className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={data ? `Search ${data.count} models…` : "Search models…"}
              className="w-full rounded-xl border border-edge bg-abyss/70 py-2.5 pl-9 pr-3 text-[0.85rem] placeholder:text-mist/60 focus:border-arc/50 focus:outline-none"
            />
          </div>

        <div className="px-4 py-3">
          {loading && <p className="py-8 text-center text-[0.8rem] text-mist">Loading catalogue…</p>}

          {data?.error && (
            <p className="mb-3 rounded-lg border border-ember/35 bg-ember/10 px-3 py-2 text-[0.75rem] text-ember">
              Couldn&apos;t reach OpenRouter: {data.error}
            </p>
          )}

          {data && !query && (
            <button
              onClick={() => pick(null)}
              className={`mb-3 flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                !data.current ? "border-arc/50 bg-arc/10" : "border-edge hover:border-arc/40"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[0.88rem] font-medium">Automatic</p>
                <p className="mt-0.5 text-[0.72rem] text-mist">
                  Free models, tried in order until one answers. No cost, variable quality.
                </p>
              </div>
              {!data.current && <CheckIcon className="mt-0.5 size-4 shrink-0 text-arc" />}
            </button>
          )}

          {data && !query && data.free.length > 0 && (
            <GroupBlock
              label="Free"
              models={data.free}
              current={data.current}
              saving={saving}
              onPick={pick}
            />
          )}

          {groups.map((group) => (
            <GroupBlock
              key={group.provider}
              label={group.label}
              models={group.models}
              current={data?.current ?? null}
              saving={saving}
              onPick={pick}
            />
          ))}

          {data && groups.length === 0 && query && (
            <p className="py-8 text-center text-[0.8rem] text-mist">No model matches “{query}”.</p>
          )}
        </div>
        </>}
      </div>
    </div>
    </div>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ kind: "error", text: "The new passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not change your password.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ kind: "success", text: "Password changed. Sign in again on your other devices." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not change your password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-3 rounded-lg border border-edge p-3">
      <div className="text-[0.7rem] uppercase tracking-[0.18em] text-mist">Account password</div>
      <p className="mt-1 text-[0.65rem] leading-snug text-mist">Change the password used by the web and mobile apps.</p>
      <form onSubmit={submit} className="mt-2 space-y-2">
        <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" className="w-full rounded-lg border border-edge bg-abyss/70 px-2.5 py-2 text-[0.8rem] placeholder:text-mist/60 focus:border-arc/50 focus:outline-none" />
        <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password (8+ characters)" className="w-full rounded-lg border border-edge bg-abyss/70 px-2.5 py-2 text-[0.8rem] placeholder:text-mist/60 focus:border-arc/50 focus:outline-none" />
        <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm new password" className="w-full rounded-lg border border-edge bg-abyss/70 px-2.5 py-2 text-[0.8rem] placeholder:text-mist/60 focus:border-arc/50 focus:outline-none" />
        {message && <p className={`text-[0.7rem] ${message.kind === "error" ? "text-ember" : "text-jade"}`}>{message.text}</p>}
        <button type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword} className="w-full rounded-lg border border-edge py-2 text-[0.75rem] text-mist transition-colors hover:border-arc/40 hover:text-frost disabled:opacity-50">
          {busy ? "Changing…" : "Change password"}
        </button>
      </form>
    </section>
  );
}

/**
 * Where speech is synthesised. Only meaningful for the natural voice — the
 * device voice never leaves the browser.
 */
function SpeechSource() {
  const [source, setSource] = useState<"auto" | "cloud" | "machine">("auto");
  const [machine, setMachine] = useState<{ name: string; engine: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        setSource(json?.settings?.speechSource ?? "auto");
        setMachine(json?.speechMachine ?? null);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  function choose(next: "auto" | "cloud" | "machine") {
    setSource(next);
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speechSource: next }),
    }).catch(() => {});
  }

  if (!loaded) return null;

  return (
    <div className="mt-2.5">
      <span className="text-[0.7rem] text-mist">Synthesised by</span>
      <div className="mt-1 flex gap-1.5">
        {(
          [
            ["auto", "Auto"],
            ["machine", "My computer"],
            ["cloud", "The API"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => choose(value)}
            className={`flex-1 rounded-lg border px-2 py-2 text-[0.72rem] transition-colors ${
              source === value ? "border-arc/50 bg-arc/10 text-arc" : "border-edge text-mist"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[0.65rem] leading-snug text-mist">
        {machine
          ? `${machine.name} is connected and can speak.`
          : "No connected machine right now — the API will be used."}
      </p>
    </div>
  );
}

function GroupBlock({
  label,
  models,
  current,
  saving,
  onPick,
}: {
  label: string;
  models: PickerModel[];
  current: string | null;
  saving: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-mist">{label}</h3>
      <ul className="space-y-1">
        {models.map((model) => {
          const active = current === model.id;
          return (
            <li key={model.id}>
              <button
                onClick={() => onPick(model.id)}
                disabled={saving !== null}
                className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                  active ? "border-arc/50 bg-arc/10" : "border-edge hover:border-arc/40"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.85rem] font-medium">{model.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.68rem] text-mist">
                    <span className={model.free ? "text-jade" : ""}>
                      {model.free
                        ? "Free"
                        : `$${model.inputPrice}/M in · $${model.outputPrice}/M out`}
                    </span>
                    <span>{Math.round(model.context / 1000)}k ctx</span>
                    {!model.tools && (
                      <span className="text-gold" title="Can't save pages — no tool calling">
                        no tools
                      </span>
                    )}
                  </p>
                </div>
                {active && <CheckIcon className="mt-0.5 size-4 shrink-0 text-arc" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
