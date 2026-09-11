"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { useSpeechInput, useSpeechOutput } from "./useSpeech";
import { useMicLevel } from "./useMicLevel";
import { ReactorOrb, type OrbState } from "./ReactorOrb";
import { SettingsSheet } from "./SettingsSheet";
import { FOCUS_COMPOSER } from "./commandBus";
import { isFarewell } from "@/lib/farewell";
import { HistorySheet, HistoryRail } from "./HistorySheet";
import { prepareImage, type PreparedImage } from "./imageUtils";
import {
  CameraIcon,
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

/** "presence" = reactor centre stage. "transcript" = reactor above a history. */
export type ChatLayout = "presence" | "transcript";

interface Citation {
  url: string;
  title: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pages?: SavedPage[];
  memories?: string[];
  sources?: Citation[];
  imageUrl?: string;
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

/**
 * How long the conversation waits in silence before closing itself.
 *
 * Long enough to think about what you want to say next, short enough that a
 * forgotten tab isn't holding the microphone open all afternoon.
 */
const IDLE_END_MS = 30_000;

/**
 * Gap between a reply finishing and the microphone reopening.
 *
 * Not cosmetic: the speaker is still settling, and reopening instantly means
 * the tail of JARVIS's own sentence lands in the next transcript.
 */
const RESUME_GAP_MS = 400;

const clock = (ms?: number) =>
  ms
    ? new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(ms)
    : "";

/** "anthropic/claude-fable-5.1" -> "claude-fable-5.1" */
const shortModel = (id: string) => id.split("/").pop()?.replace(/:free$/, "·free") ?? id;

export function ChatView({
  initialConversationId,
  initialPrompt,
  initialLayout = "presence",
  initialAutoListen = false,
}: {
  initialConversationId?: string;
  initialPrompt?: string;
  initialLayout?: ChatLayout;
  initialAutoListen?: boolean;
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
  const [attachment, setAttachment] = useState<PreparedImage | null>(null);
  const [attaching, setAttaching] = useState(false);

  const [layout, setLayout] = useState<ChatLayout>(initialLayout);
  const [autoListen, setAutoListen] = useState(initialAutoListen);

  /**
   * Whether a hands-free conversation is open.
   *
   * This is the difference between "press to dictate" and an actual
   * conversation: while it's true, the microphone reopens on its own after
   * every reply, so you can keep talking without touching anything.
   */
  const [live, setLive] = useState(false);

  /**
   * Set when the last thing you said was a goodbye. The conversation doesn't
   * stop dead — the reply still runs and is spoken — but once the floor is
   * free we close instead of reopening the microphone.
   */
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const voice = useSpeechOutput();
  const micLevel = useMicLevel();

  // "/" anywhere on the page jumps to the composer, the way every chat app does.
  useEffect(() => {
    const focus = () => textareaRef.current?.focus();
    window.addEventListener(FOCUS_COMPOSER, focus);
    return () => window.removeEventListener(FOCUS_COMPOSER, focus);
  }, []);

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

  const persistSetting = useCallback((patch: { chatLayout?: ChatLayout; autoListen?: boolean }) => {
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
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
            .map(
              (m: {
                id: string;
                role: string;
                content: string;
                model?: string;
                imageUrl?: string;
                createdAt: string;
              }) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                model: m.model ?? undefined,
                imageUrl: m.imageUrl ?? undefined,
                at: new Date(m.createdAt).getTime(),
              })
            )
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialConversationId) loadConversation(initialConversationId);
  }, [initialConversationId, loadConversation]);

  useEffect(() => {
    if (layout === "transcript") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, status, layout]);

  /* ---- sending -------------------------------------------------------- */

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const photo = attachment;
      if ((!trimmed && !photo) || busy) return;

      // "Thanks JARVIS", "that's all", "talk to you later". Answer it and speak
      // the reply, then close — ending mid-utterance would be rude and would
      // swallow the answer. Only meaningful while a conversation is open;
      // typing "thanks" with the mic shut changes nothing.
      if (liveRef.current && isFarewell(trimmed)) {
        closingRef.current = true;
        setClosing(true);
      }

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

      setAttachment(null);

      const userMessage: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed || (photo ? "What am I looking at?" : ""),
        imageUrl: photo?.thumb,
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
          body: JSON.stringify({
            message: trimmed,
            conversationId,
            image: photo?.full,
            thumbnail: photo?.thumb,
          }),
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
              case "searching":
                setStatus(`Searching · ${String(event.query).slice(0, 32)}`);
                break;
              case "sources":
                patch((m) => ({ ...m, sources: (event as unknown as { citations: Citation[] }).citations }));
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
    [busy, conversationId, voice, attachment]
  );

  const mic = useSpeechInput(
    useCallback(
      (text: string) => {
        void send(text);
      },
      [send]
    ),
    // While a conversation is open the microphone stays open through silence
    // rather than giving up and complaining it heard nothing.
    { keepAlive: live }
  );

  useEffect(() => {
    if (!mic.listening && micLevel.active) micLevel.stop();
  }, [mic.listening, micLevel]);

  /* ---- the conversation loop ------------------------------------------ */

  /*
   * These three effects are what turn a dictation box into a conversation.
   * They all read their callbacks through refs: the objects useSpeechInput and
   * useSpeechOutput return are rebuilt every render, so depending on them
   * directly would re-run the effects constantly and the timers below would be
   * cleared before they ever fired.
   */
  const micStartRef = useRef(mic.start);
  const micCancelRef = useRef(mic.cancel);
  const shutUpRef = useRef(voice.shutUp);
  const unlockRef = useRef(voice.unlock);
  micStartRef.current = mic.start;
  micCancelRef.current = mic.cancel;
  shutUpRef.current = voice.shutUp;
  unlockRef.current = voice.unlock;

  const liveRef = useRef(live);
  const busyRef = useRef(busy);
  // `pending` covers the whole reply, gaps included — `speaking` alone dips to
  // false between audio chunks, which is precisely when we must not open the mic.
  const speakingRef = useRef(voice.pending || voice.speaking);
  liveRef.current = live;
  busyRef.current = busy;
  speakingRef.current = voice.pending || voice.speaking;

  const endConversation = useCallback(() => {
    setLive(false);
    setClosing(false);
    closingRef.current = false;
    micCancelRef.current();
    shutUpRef.current();
  }, []);

  const endRef = useRef(endConversation);
  endRef.current = endConversation;

  // Reopen the microphone once the floor is free. Never while a reply is
  // playing — an open mic during playback transcribes JARVIS talking to itself.
  useEffect(() => {
    if (!live || busy || voice.pending || voice.speaking || mic.listening) return;

    // You said goodbye and the reply has now finished playing. Close instead
    // of reopening — this is the whole point of noticing the sign-off.
    if (closingRef.current) {
      closingRef.current = false;
      endRef.current();
      return;
    }

    const timer = setTimeout(() => {
      // Re-check at fire time rather than trusting the values this effect
      // closed over. The speech queue reports "not speaking" in the gap between
      // two audio chunks, and without this a long reply with a pause in it
      // would open the microphone into the middle of its own sentence.
      if (liveRef.current && !busyRef.current && !speakingRef.current) {
        micStartRef.current();
      }
    }, RESUME_GAP_MS);
    return () => clearTimeout(timer);
  }, [live, busy, voice.pending, voice.speaking, mic.listening]);

  // Close the conversation after a stretch of silence. activityAt changes on
  // every detected utterance, which re-runs this and pushes the deadline back.
  useEffect(() => {
    if (!live || !mic.listening) return;
    const timer = setTimeout(() => endRef.current(), IDLE_END_MS);
    return () => clearTimeout(timer);
  }, [live, mic.listening, mic.activityAt]);

  // Audio playback needs a gesture before iOS will allow it. With auto-listen
  // on there may never be a deliberate tap, so the first interaction of any
  // kind — anywhere on the page — is what primes it.
  useEffect(() => {
    const prime = () => unlockRef.current();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  // Open the conversation on arrival when that's the preference.
  useEffect(() => {
    if (initialAutoListen) setLive(true);
  }, [initialAutoListen]);

  const toggleConversation = useCallback(() => {
    voice.unlock();
    if (liveRef.current) {
      endConversation();
      return;
    }
    closingRef.current = false;
    setClosing(false);
    void micLevel.start(); // desktop only; no-ops on mobile
    setLive(true);
  }, [voice, micLevel, endConversation]);

  // Escape ends the conversation.
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live]);

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

  const orbState: OrbState = mic.listening
    ? "listening"
    : busy
      ? "thinking"
      : voice.speaking
        ? "speaking"
        : "idle";

  const modelLabel = activeModel ?? selectedModel;

  const stageLabel = mic.listening
    ? "Listening"
    : busy
      ? (status ?? "Thinking")
      : closing
        ? "Signing off"
        : voice.speaking
          ? "Speaking"
          : live
            ? "Go ahead"
            : "Standing by";

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  const orbPress = mic.supported ? toggleConversation : undefined;
  const orbLabel = live ? "End the conversation" : "Start talking to JARVIS";

  const notices = (
    <>
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
    </>
  );

  const orb = (size: string) => (
    <ReactorOrb
      state={orbState}
      level={micLevel.level}
      activityAt={mic.activityAt}
      amplitudeRef={voice.amplitudeRef}
      onPress={orbPress}
      pressLabel={orbLabel}
      className={size}
    />
  );

  return (
    <div className="flex h-full">
      {/* The conversation column. The rail below sits beside it from xl. */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* ---- header -------------------------------------------------- */}
        <header className="shrink-0 border-b border-edge bg-abyss/70 backdrop-blur-xl safe-top">
          <div className="mx-auto flex max-w-lg md:max-w-2xl lg:max-w-3xl items-center gap-3 px-4 pt-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[0.82rem] font-semibold tracking-[0.22em]">
                JARVIS
                <span
                  className={`size-1.5 rounded-full ${
                    busy || mic.listening ? "live-dot bg-arc" : live ? "bg-arc/70" : "bg-jade/70"
                  }`}
                />
              </p>
              <p className="truncate text-[0.66rem] text-mist">{stageLabel}</p>
            </div>

            {/* Redundant from xl, where the rail is always on screen. */}
            <button
              onClick={() => setHistoryOpen(true)}
              aria-label="Conversation history"
              className="p-2 text-mist transition-colors hover:text-frost xl:hidden"
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
          <div className="relative mx-auto flex max-w-lg md:max-w-2xl lg:max-w-3xl items-center gap-3 overflow-hidden px-4 pb-2 pt-1.5">
            <span className="readout truncate">{modelLabel ? shortModel(modelLabel) : "auto"}</span>
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

        {/* ---- the stage ----------------------------------------------- */}
        {layout === "presence" ? (
          /*
           * Presence. The reactor holds the centre and never leaves; the words
           * come and go around it. No scrollback here on purpose — that's what
           * the transcript layout and the history rail are for.
           */
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-5 py-4">
            <Reticle>{orb("size-40 sm:size-48 lg:size-56")}</Reticle>

            <p className="readout mt-5 flex items-center gap-2">
              {(mic.listening || busy) && <span className="live-dot size-1 rounded-full bg-arc" />}
              {stageLabel}
            </p>

            {/* what you just said */}
            {(mic.listening || lastUser) && (
              <p className="mt-4 line-clamp-2 max-w-xl text-center text-[0.88rem] leading-snug text-mist">
                {mic.listening ? mic.interim || "…" : lastUser?.content}
              </p>
            )}

            {/* what it's saying back */}
            <div className="mt-3 max-h-[32vh] w-full max-w-2xl overflow-y-auto overscroll-contain px-1">
              {lastAssistant?.content ? (
                <div className="text-[0.95rem] leading-relaxed">
                  <Markdown>{lastAssistant.content}</Markdown>
                </div>
              ) : busy ? (
                <p className="text-center">
                  <span className="caret text-mist" />
                </p>
              ) : messages.length === 0 ? (
                <p className="mx-auto max-w-sm text-center text-[0.85rem] leading-snug text-mist">
                  {orbPress
                    ? "Tap the reactor and start talking. I'll keep listening between answers."
                    : "Ask for a workout or a recipe — I'll save it to a page you can come back to."}
                </p>
              ) : null}

              {lastAssistant && (lastAssistant.pages?.length || lastAssistant.memories?.length) ? (
                <div className="mt-3 space-y-1.5">
                  {lastAssistant.pages?.map((page) => (
                    <PageChip key={page.slug} page={page} label="Saved" />
                  ))}
                  {lastAssistant.memories?.map((memory, i) => (
                    <p key={i} className="readout text-jade/80">
                      ▸ noted — <span className="normal-case tracking-normal text-mist">{memory}</span>
                    </p>
                  ))}
                </div>
              ) : null}

              {matches.length > 0 && (
                <div className="rise mt-4 border border-gold/25 bg-gold/[0.05] p-3">
                  <p className="readout mb-2 text-gold">Already in your library</p>
                  <div className="space-y-1.5">
                    {matches.map((page) => (
                      <PageChip key={page.slug} page={page} label={`${page.score}%`} />
                    ))}
                  </div>
                </div>
              )}

              <div className="mx-auto max-w-md">{notices}</div>
            </div>
          </div>
        ) : (
          /*
           * Transcript. Same reactor, pinned above the history rather than
           * competing with it for the middle of the screen.
           */
          <>
            <div className="flex shrink-0 flex-col items-center border-b border-edge py-3">
              {orb("size-24 lg:size-28")}
              <p className="readout mt-2 flex items-center gap-2">
                {(mic.listening || busy) && <span className="live-dot size-1 rounded-full bg-arc" />}
                {mic.listening ? mic.interim || stageLabel : stageLabel}
              </p>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto flex min-h-full max-w-lg md:max-w-2xl lg:max-w-3xl flex-col px-4 py-4">
                {messages.length === 0 && (
                  <p className="mx-auto mt-10 max-w-sm text-center text-[0.85rem] leading-snug text-mist">
                    {orbPress
                      ? "Tap the reactor and start talking. I'll keep listening between answers."
                      : "Ask for a workout or a recipe — I'll save it to a page you can come back to."}
                  </p>
                )}

                <ul className="space-y-5">
                  {messages.map((message) => (
                    <li key={message.id} className="rise">
                      {message.role === "user" ? (
                        <div className="flex justify-end">
                          <div className="notch-tr max-w-[86%] border border-arc/25 bg-arc/[0.07] text-[0.92rem] leading-snug">
                            {message.imageUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={message.imageUrl}
                                alt="Attached photo"
                                className="max-h-56 w-full object-cover"
                              />
                            )}
                            <p className="px-3.5 py-2.5">{message.content}</p>
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

                          {message.sources && message.sources.length > 0 && (
                            <div className="mt-2.5 pl-3">
                              <p className="readout mb-1">Sources</p>
                              <ul className="space-y-0.5">
                                {message.sources.slice(0, 5).map((source) => (
                                  <li key={source.url}>
                                    <a
                                      href={source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block truncate text-[0.72rem] text-arc/80 underline underline-offset-2"
                                    >
                                      {source.title || source.url}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {(message.pages?.length || message.memories?.length) && (
                            <div className="mt-2.5 space-y-1.5 pl-3">
                              {message.pages?.map((page) => (
                                <PageChip key={page.slug} page={page} label="Saved" />
                              ))}
                              {message.memories?.map((memory, i) => (
                                <p key={i} className="readout text-jade/80">
                                  ▸ noted —{" "}
                                  <span className="normal-case tracking-normal text-mist">{memory}</span>
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

                {notices}

                <div ref={bottomRef} className="h-2" />
              </div>
            </div>
          </>
        )}

        {/* ---- composer ------------------------------------------------- */}
        <div className="shrink-0 border-t border-edge bg-abyss/80 backdrop-blur-xl">
          {chips.length > 0 && !busy && !mic.listening && messages.length === 0 && (
            <div
              className="-mb-1 overflow-x-auto"
              style={{
                maskImage: "linear-gradient(90deg, #000 88%, transparent)",
                WebkitMaskImage: "linear-gradient(90deg, #000 88%, transparent)",
              }}
            >
              <div className="mx-auto flex max-w-lg md:max-w-2xl lg:max-w-3xl gap-1.5 px-4 pb-1 pt-2.5">
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

          {attachment && (
            <div className="mx-auto flex max-w-lg md:max-w-2xl lg:max-w-3xl items-center gap-3 px-4 pt-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.thumb}
                alt="Attached"
                className="size-12 border border-arc/30 object-cover"
              />
              <p className="readout flex-1">
                Photo attached · {attachment.width}×{attachment.height}
              </p>
              <button
                onClick={() => setAttachment(null)}
                aria-label="Remove photo"
                className="border border-edge p-1.5 text-mist transition-colors hover:text-ember"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          )}

          {attaching && (
            <p className="readout mx-auto max-w-lg px-4 pt-2.5 md:max-w-2xl lg:max-w-3xl">Preparing photo…</p>
          )}

          {live && (
            <p className="readout mx-auto max-w-lg px-4 pt-2 md:max-w-2xl lg:max-w-3xl">
              {closing
                ? "Signing off · I'll stop listening once I've finished"
                : mic.listening
                  ? `Conversation open · sends after ${(mic.silenceMs / 1000).toFixed(1)}s quiet`
                  : "Conversation open · I'll listen again when I've finished"}
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="mx-auto flex max-w-lg md:max-w-2xl lg:max-w-3xl items-end gap-2 px-3 py-2.5"
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
                // Enter sends; Shift+Enter is a newline. Cmd/Ctrl+Enter also
                // sends, because plenty of people have that in their fingers.
                if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              readOnly={mic.listening}
              rows={1}
              placeholder="Ask JARVIS…"
              className="max-h-[132px] min-h-[42px] flex-1 resize-none border border-edge bg-void/60 px-3.5 py-2.5 text-[0.92rem] text-frost placeholder:text-mist/50 focus:border-arc/50 focus:outline-none"
            />

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setAttaching(true);
                try {
                  setAttachment(await prepareImage(file));
                } catch {
                  setError("Couldn't read that image.");
                } finally {
                  setAttaching(false);
                }
              }}
            />

            {!busy && !mic.listening && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Attach a photo"
                className={`shrink-0 border p-3 transition-colors ${
                  attachment ? "border-arc/50 text-arc" : "border-edge text-mist hover:text-frost"
                }`}
              >
                <CameraIcon className="size-5" />
              </button>
            )}

            {mic.supported && (
              <button
                type="button"
                onClick={toggleConversation}
                aria-label={orbLabel}
                className={`relative shrink-0 p-3 transition-colors ${
                  live ? "listening bg-arc/20 text-arc" : "border border-edge text-mist hover:text-frost"
                }`}
              >
                <MicIcon className="size-5" />
              </button>
            )}

            <button
              type={busy ? "button" : "submit"}
              onClick={busy ? stop : undefined}
              disabled={!busy && !input.trim() && !attachment}
              aria-label={busy ? "Stop" : "Send"}
              className="notch-tr shrink-0 bg-arc p-3 text-void transition-opacity disabled:opacity-25"
            >
              {busy ? <StopIcon className="size-5" /> : <SendIcon className="size-5" />}
            </button>
          </form>
        </div>
      </div>

      {/* Always-visible conversation list, from xl up. */}
      <HistoryRail onPick={loadConversation} currentId={conversationId} />

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
        layout={layout}
        onLayoutChange={(next) => {
          setLayout(next);
          persistSetting({ chatLayout: next });
        }}
        autoListen={autoListen}
        onAutoListenChange={(next) => {
          setAutoListen(next);
          persistSetting({ autoListen: next });
        }}
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
