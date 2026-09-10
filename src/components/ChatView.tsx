"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { useSpeechInput, useSpeechOutput } from "./useSpeech";
import { useMicLevel } from "./useMicLevel";
import { ReactorOrb, type OrbState } from "./ReactorOrb";
import { SettingsSheet } from "./SettingsSheet";
import { HistorySheet } from "./HistorySheet";
import {
  GearIcon,
  HistoryIcon,
  MicIcon,
  MuteIcon,
  PAGE_ICONS,
  SendIcon,
  SpeakerIcon,
  StopIcon,
  XIcon,
} from "./Icons";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pages?: SavedPage[];
  memories?: string[];
  model?: string;
  at?: number;
}

interface SavedPage {
  slug: string;
  title: string;
  pageType: string;
}

interface MatchPage extends SavedPage {
  score: number;
  strong: boolean;
}

interface Chip {
  label: string;
  prompt: string;
}

const TOOL_LABELS = {
  save_page: "Writing that up",
  search_pages: "Checking library",
  update_page: "Revising page",
  remember: "Committing to memory",
  add_task: "Adding task",
  list_tasks: "Reading tasks",
  log_activity: "Logging",
  recent_activity: "Reviewing week",
} as const;

const clock = (ms?: number) =>
  ms
    ? new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(ms)
    : "";

/** "anthropic/claude-fable-5.1" -> "claude-fable-5.1" */
const shortModel = (id: string) => id.split("/").pop()?.replace(/:free$/, "·free") ?? id;

export function ChatView({
  initialConversationId,
  initialPrompt,
}: {
  initialConversationId?: string;
  initialPrompt?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(initialPrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const voice = useSpeechOutput();
  const micLevel = useMicLevel();

  /* ---- data ---------------------------------------------------------- */

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const model = data?.profile?.data?.model;
        if (typeof model === "string" && model) setSelectedModel(model);
      })
      .catch(() => {});

    fetch("/api/suggestions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setChips(data?.chips ?? []))
      .catch(() => {});
  }, []);

  const loadConversation = useCallback((id: string) => {
    fetch(`/api/conversations?id=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.conversation) return;
        setConversationId(id);
        setMessages(
          data.conversation.messages
            .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
            .map((m: { id: string; role: string; content: string; model?: string; createdAt: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              model: m.model ?? undefined,
              at: new Date(m.createdAt).getTime(),
            }))
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialConversationId) loadConversation(initialConversationId);
  }, [initialConversationId, loadConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  /* ---- sending -------------------------------------------------------- */

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      // Inside the tap/Enter — the only moment iOS will prime speech synthesis.
      voice.unlock();
      voice.startFeed();
      let assistantText = "";
      const startedAt = performance.now();
      let firstToken = false;

      setError(null);
      setMatches([]);
      setInput("");
      setBusy(true);
      setStatus("Thinking");
      setLatency(null);

      const userMessage: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
        at: Date.now(),
      };
      const assistantId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: "assistant", content: "", at: Date.now() },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, conversationId }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(res.status === 401 ? "Session expired — sign in again." : `Server returned ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let event: Record<string, string> & { pages?: MatchPage[]; delta?: string };
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }

            switch (event.type) {
              case "text":
                if (!firstToken) {
                  firstToken = true;
                  setLatency(Math.round(performance.now() - startedAt));
                }
                setStatus(null);
                assistantText += event.delta;
                patch((m) => ({ ...m, content: m.content + event.delta }));
                voice.feed(assistantText);
                break;
              case "model":
                setActiveModel(event.model);
                patch((m) => ({ ...m, model: event.model }));
                break;
              case "match":
                setMatches(event.pages ?? []);
                break;
              case "tool_start":
                setStatus(TOOL_LABELS[event.name as keyof typeof TOOL_LABELS] ?? "Working");
                break;
              case "page_saved":
                patch((m) => ({
                  ...m,
                  pages: [...(m.pages ?? []), { slug: event.slug, title: event.title, pageType: event.pageType }],
                }));
                break;
              case "memory_saved":
                patch((m) => ({ ...m, memories: [...(m.memories ?? []), event.content] }));
                break;
              case "done":
                setConversationId(event.conversationId);
                setStatus(null);
                voice.endFeed();
                break;
              case "error":
                setError(event.message);
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Connection lost.");
        }
      } finally {
        setBusy(false);
        setStatus(null);
        abortRef.current = null;
        voice.endFeed();
      }
    },
    [busy, conversationId, voice]
  );

  const mic = useSpeechInput(
    useCallback(
      (text: string) => {
        void send(text);
      },
      [send]
    )
  );

  useEffect(() => {
    if (!mic.listening && micLevel.active) micLevel.stop();
  }, [mic.listening, micLevel]);

  const orbState: OrbState = mic.listening
    ? "listening"
    : busy
      ? "thinking"
      : voice.speaking
        ? "speaking"
        : "idle";

  const startVoice = () => {
    voice.unlock();
    void micLevel.start(); // desktop only; no-ops on mobile
    mic.start();
  };

  const stop = () => {
    abortRef.current?.abort();
    voice.shutUp();
    setBusy(false);
    setStatus(null);
  };

  const newConversation = () => {
    stop();
    setMessages([]);
    setMatches([]);
    setConversationId(undefined);
    setError(null);
    setLatency(null);
  };

  /* ---- render ---------------------------------------------------------- */

  const modelLabel = activeModel ?? selectedModel;

  return (
    <div className="flex h-full flex-col">
      {/* ---- header ---------------------------------------------------- */}
      <header className="shrink-0 border-b border-edge bg-abyss/70 backdrop-blur-xl safe-top">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 pt-3">
          <ReactorOrb
            state={orbState}
            level={micLevel.level}
            activityAt={mic.activityAt}
            className="size-11 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[0.82rem] font-semibold tracking-[0.22em]">
              JARVIS
              <span
                className={`size-1.5 rounded-full ${
                  busy || mic.listening ? "live-dot bg-arc" : "bg-jade/70"
                }`}
              />
            </p>
            <p className="truncate text-[0.66rem] text-mist">
              {status ? `${status}…` : busy ? "Responding" : mic.listening ? "Listening" : "Standing by"}
            </p>
          </div>

          <button
            onClick={() => setHistoryOpen(true)}
            aria-label="Conversation history"
            className="p-2 text-mist transition-colors hover:text-frost"
          >
            <HistoryIcon className="size-[18px]" />
          </button>
          {voice.supported && (
            <button
              onClick={voice.toggle}
              aria-label={voice.enabled ? "Mute replies" : "Speak replies"}
              className={`p-2 transition-colors ${voice.enabled ? "text-arc" : "text-mist hover:text-frost"}`}
            >
              {voice.enabled ? <SpeakerIcon className="size-[18px]" /> : <MuteIcon className="size-[18px]" />}
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="p-2 text-mist transition-colors hover:text-frost"
          >
            <GearIcon className="size-[18px]" />
          </button>
        </div>

        {/* telemetry — machine data in mono, prose stays in the sans face */}
        <div className="relative mx-auto flex max-w-lg items-center gap-3 overflow-hidden px-4 pb-2 pt-1.5">
          <span className="readout truncate">
            {modelLabel ? shortModel(modelLabel) : "auto"}
          </span>
          <span className="readout">{latency != null ? `${latency}ms` : "—"}</span>
          <span className="readout">{messages.length} msg</span>
          {messages.length > 0 && (
            <button onClick={newConversation} className="readout ml-auto hover:text-arc">
              New
            </button>
          )}
        </div>
        <div className={`rule-fade ${busy ? "scanning relative" : ""}`} />
      </header>

      {/* ---- transcript -------------------------------------------------- */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full max-w-lg flex-col px-4 py-4">
          {messages.length === 0 && (
            <EmptyState orbState={orbState} level={micLevel.level} activityAt={mic.activityAt} />
          )}

          <ul className="space-y-5">
            {messages.map((message) => (
              <li key={message.id} className="rise">
                {message.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="notch-tr max-w-[86%] border border-arc/25 bg-arc/[0.07] px-3.5 py-2.5 text-[0.92rem] leading-snug">
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="readout mb-1.5 flex items-center gap-2">
                      <span className="text-arc/80">JARVIS</span>
                      {message.at && <span>{clock(message.at)}</span>}
                      {message.model && <span className="truncate">{shortModel(message.model)}</span>}
                    </p>
                    <div className="border-l border-edge pl-3 text-[0.92rem]">
                      {message.content ? (
                        <Markdown>{message.content}</Markdown>
                      ) : (
                        <span className="caret text-mist" />
                      )}
                    </div>

                    {(message.pages?.length || message.memories?.length) && (
                      <div className="mt-2.5 space-y-1.5 pl-3">
                        {message.pages?.map((page) => (
                          <PageChip key={page.slug} page={page} label="Saved" />
                        ))}
                        {message.memories?.map((memory, i) => (
                          <p key={i} className="readout text-jade/80">
                            ▸ noted — <span className="normal-case tracking-normal text-mist">{memory}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {matches.length > 0 && (
            <div className="rise mt-5 border border-gold/25 bg-gold/[0.05] p-3">
              <p className="readout mb-2 text-gold">Already in your library</p>
              <div className="space-y-1.5">
                {matches.map((page) => (
                  <PageChip key={page.slug} page={page} label={`${page.score}%`} />
                ))}
              </div>
            </div>
          )}

          {voice.error && (
            <p className="mt-4 border border-edge px-3 py-2 text-[0.74rem] text-mist">{voice.error}</p>
          )}
          {mic.error && (
            <p className="mt-4 border border-gold/35 bg-gold/[0.07] px-3 py-2 text-[0.78rem] leading-snug text-gold">
              {mic.error}
            </p>
          )}
          {error && (
            <p className="mt-4 border border-ember/35 bg-ember/[0.07] px-3 py-2 text-[0.78rem] text-ember">
              {error}
            </p>
          )}

          <div ref={bottomRef} className="h-2" />
        </div>
      </div>

      {/* ---- composer ---------------------------------------------------- */}
      <div className="shrink-0 border-t border-edge bg-abyss/80 backdrop-blur-xl">
        {chips.length > 0 && !busy && !mic.listening && (
          <div
            className="-mb-1 overflow-x-auto"
            style={{
              maskImage: "linear-gradient(90deg, #000 88%, transparent)",
              WebkitMaskImage: "linear-gradient(90deg, #000 88%, transparent)",
            }}
          >
            <div className="mx-auto flex max-w-lg gap-1.5 px-4 pb-1 pt-2.5">
              {chips.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => {
                    if (chip.prompt.trim().endsWith(":")) {
                      setInput(chip.prompt);
                      textareaRef.current?.focus();
                    } else {
                      void send(chip.prompt);
                    }
                  }}
                  className="shrink-0 whitespace-nowrap border border-edge px-2.5 py-1.5 text-[0.7rem] text-mist transition-colors hover:border-arc/40 hover:text-frost"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {mic.listening && (
          <p className="mx-auto max-w-lg px-4 pt-2 readout">
            Listening · sends after {(mic.silenceMs / 1000).toFixed(1)}s quiet
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="mx-auto flex max-w-lg items-end gap-2 px-3 py-2.5"
        >
          <textarea
            ref={textareaRef}
            value={mic.listening ? mic.interim || "Listening…" : input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            readOnly={mic.listening}
            rows={1}
            placeholder="Ask JARVIS…"
            className="max-h-[132px] min-h-[42px] flex-1 resize-none border border-edge bg-void/60 px-3.5 py-2.5 text-[0.92rem] text-frost placeholder:text-mist/50 focus:border-arc/50 focus:outline-none"
          />

          {mic.supported && !busy && mic.listening && (
            <button
              type="button"
              onClick={mic.cancel}
              aria-label="Cancel dictation"
              className="shrink-0 border border-edge p-3 text-mist transition-colors hover:text-ember"
            >
              <XIcon className="size-5" />
            </button>
          )}

          {mic.supported && !busy && (
            <button
              type="button"
              onClick={mic.listening ? mic.stop : startVoice}
              aria-label={mic.listening ? "Send now" : "Speak"}
              className={`relative shrink-0 p-3 transition-colors ${
                mic.listening ? "listening bg-arc/20 text-arc" : "border border-edge text-mist hover:text-frost"
              }`}
            >
              <MicIcon className="size-5" />
            </button>
          )}

          <button
            type={busy ? "button" : "submit"}
            onClick={busy ? stop : undefined}
            disabled={!busy && !input.trim()}
            aria-label={busy ? "Stop" : "Send"}
            className="notch-tr shrink-0 bg-arc p-3 text-void transition-opacity disabled:opacity-25"
          >
            {busy ? <StopIcon className="size-5" /> : <SendIcon className="size-5" />}
          </button>
        </form>
      </div>

      {/* ---- overlays ---------------------------------------------------- */}
      {mic.listening && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-void/93 px-8 backdrop-blur-md">
          <ReactorOrb
            state="listening"
            level={micLevel.level}
            activityAt={mic.activityAt}
            className="size-64"
          />

          <p className="min-h-[3.5rem] max-w-sm text-center text-[1.05rem] leading-snug text-frost">
            {mic.interim || <span className="text-mist">Listening…</span>}
          </p>

          {mic.error ? (
            <p className="max-w-xs text-center text-[0.78rem] leading-snug text-gold">{mic.error}</p>
          ) : (
            <p className="readout">Sends after {(mic.silenceMs / 1000).toFixed(1)}s of quiet</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={mic.cancel}
              className="border border-edge px-5 py-2.5 text-[0.8rem] text-mist transition-colors hover:text-frost"
            >
              Cancel
            </button>
            <button
              onClick={mic.stop}
              className="notch-tr bg-arc px-6 py-2.5 text-[0.8rem] font-semibold text-void"
            >
              Send now
            </button>
          </div>
        </div>
      )}

      <HistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onPick={loadConversation}
        currentId={conversationId}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onModelChange={setSelectedModel}
        voiceMode={voice.mode}
        onVoiceModeChange={voice.setMode}
      />
    </div>
  );
}

/** Four corner ticks. Two (the CSS-only version) read as a rendering bug. */
function Reticle({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative p-4">
      {(
        [
          "left-0 top-0 border-l border-t",
          "right-0 top-0 border-r border-t",
          "left-0 bottom-0 border-l border-b",
          "right-0 bottom-0 border-r border-b",
        ] as const
      ).map((position) => (
        <span
          key={position}
          aria-hidden
          className={`pointer-events-none absolute size-3.5 border-arc/40 ${position}`}
        />
      ))}
      {children}
    </div>
  );
}

function PageChip({ page, label }: { page: SavedPage; label: string }) {
  const Icon = PAGE_ICONS[page.pageType as keyof typeof PAGE_ICONS] ?? PAGE_ICONS.note;
  return (
    <Link
      href={`/pages/${page.slug}`}
      className="flex items-center gap-2.5 border border-edge bg-panel/40 px-3 py-2 transition-colors hover:border-arc/40"
    >
      <Icon className="size-3.5 shrink-0 text-arc" />
      <span className="flex-1 truncate text-[0.82rem]">{page.title}</span>
      <span className="readout">{label}</span>
    </Link>
  );
}

function EmptyState({
  orbState,
  level,
  activityAt,
}: {
  orbState: OrbState;
  level: number;
  activityAt: number;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-8 text-center">
      <Reticle>
        <ReactorOrb state={orbState} level={level} activityAt={activityAt} className="size-40" />
      </Reticle>
      <p className="readout mt-6">System ready</p>
      <p className="mt-2 text-[1rem] text-frost">At your service.</p>
      <p className="mx-auto mt-1.5 max-w-[17rem] text-[0.8rem] leading-snug text-mist">
        Ask for a workout or a recipe — I&apos;ll save it to a page you can come back to.
      </p>
    </div>
  );
}
