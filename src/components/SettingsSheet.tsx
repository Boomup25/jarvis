"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, SearchIcon, MicIcon } from "./Icons";
import { DEFAULT_SILENCE_MS, readSilenceMs, writeSilenceMs, type VoiceMode } from "./useSpeech";

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
}: {
  open: boolean;
  onClose: () => void;
  onModelChange: (id: string | null) => void;
  voiceMode: VoiceMode;
  onVoiceModeChange: (mode: VoiceMode) => void;
}) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [savingVoice, setSavingVoice] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [data, setData] = useState<CatalogueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [silence, setSilence] = useState(DEFAULT_SILENCE_MS);
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 bg-void/70 backdrop-blur-sm"
      />

      <div className="relative flex max-h-[88dvh] flex-col rounded-t-2xl glass safe-bottom">
        <div className="shrink-0 border-b border-edge px-4 pb-3 pt-3">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-edge" />

          <section className="mb-3">
            <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-mist">
              <MicIcon className="size-3.5" />
              Voice
            </div>
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

          <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-mist">
            Model
          </div>
          <div className="relative mt-2">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={data ? `Search ${data.count} models…` : "Search models…"}
              className="w-full rounded-xl border border-edge bg-abyss/70 py-2.5 pl-9 pr-3 text-[0.85rem] placeholder:text-mist/60 focus:border-arc/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
      </div>
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
