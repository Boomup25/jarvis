"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { useSpeechInput, useSpeechOutput } from "./useSpeech";
import {
  GearIcon,
  MicIcon,
  MuteIcon,
  PAGE_ICONS,
  SendIcon,
  SpeakerIcon,
  StopIcon,
  XIcon,
} from "./Icons";
import { SettingsSheet } from "./SettingsSheet";
import { ReactorOrb, type OrbState } from "./ReactorOrb";
import { useMicLevel } from "./useMicLevel";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pages?: SavedPage[];
  memories?: string[];
  model?: string;
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

const SUGGESTIONS = [
  "Give me today's workout",
  "What should I eat tonight?",
  "What do you know about me?",
  "Plan my week",
];

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
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const spokenRef = useRef<string>("");

  const voice = useSpeechOutput();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const model = data?.profile?.data?.model;
        if (typeof model === "string" && model) setSelectedModel(model);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!initialConversationId) return;
    fetch(`/api/conversations?id=${initialConversationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.conversation) return;
        setMessages(
          data.conversation.messages
            .filter((m: any) => m.role === "user" || m.role === "assistant")
            .map((m: any) => ({ id: m.id, role: m.role, content: m.content }))
        );
      })
      .catch(() => {});
  }, [initialConversationId]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      setError(null);
      setMatches([]);
      setInput("");
      setBusy(true);
      setStatus("Thinking");
      spokenRef.current = "";

      const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: trimmed };
      const assistantId = `a-${Date.now()}`;
      setMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "" }]);

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
            let event: any;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }

            switch (event.type) {
              case "text":
                setStatus(null);
                patch((m) => ({ ...m, content: m.content + event.delta }));
                break;
              case "model":
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
        // Read the finished reply out loud, once.
        setMessages((prev) => {
          const last = prev.find((m) => m.id === assistantId);
          if (last?.content && last.content !== spokenRef.current) {
            spokenRef.current = last.content;
            voice.speak(last.content);
          }
          return prev;
        });
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

  const micLevel = useMicLevel();

  // Release the audio stream whenever dictation ends, including the silence
  // timeout finishing on its own.
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
    void micLevel.start();
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
  };

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="safe-top sticky top-0 z-30 glass border-b border-edge">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <ReactorOrb state={orbState} level={micLevel.level} className="size-9 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold tracking-wide">JARVIS</p>
            <p className="truncate text-[0.68rem] text-mist">
              {status
                ? `${status}…`
                : busy
                  ? "Responding…"
                  : selectedModel
                    ? shortModel(selectedModel)
                    : "Auto · free models"}
            </p>
          </div>
          {voice.supported && (
            <button
              onClick={voice.toggle}
              aria-label={voice.enabled ? "Mute spoken replies" : "Speak replies aloud"}
              className={`rounded-lg p-2 transition-colors ${
                voice.enabled ? "text-arc" : "text-mist hover:text-frost"
              }`}
            >
              {voice.enabled ? <SpeakerIcon className="size-5" /> : <MuteIcon className="size-5" />}
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Model and voice settings"
            className="rounded-lg p-2 text-mist transition-colors hover:text-frost"
          >
            <GearIcon className="size-5" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={newConversation}
              className="rounded-lg border border-edge px-2.5 py-1.5 text-[0.68rem] text-mist transition-colors hover:text-frost"
            >
              New
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 px-4 pb-44 pt-4">
        {messages.length === 0 && <EmptyState onPick={(text) => void send(text)} />}

        <ul className="space-y-4">
          {messages.map((message) => (
            <li key={message.id} className="rise">
              {message.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-arc/12 px-3.5 py-2.5 text-[0.94rem] text-frost ring-1 ring-arc/25">
                    {message.content}
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="rounded-2xl rounded-bl-md glass px-3.5 py-3 text-[0.94rem]">
                    {message.content ? (
                      <Markdown>{message.content}</Markdown>
                    ) : (
                      <span className="caret text-mist" />
                    )}
                  </div>
                  {message.pages?.map((page) => (
                    <PageChip key={page.slug} page={page} label="Saved" />
                  ))}
                  {message.memories?.map((memory, i) => (
                    <p key={i} className="pl-1 text-[0.72rem] text-mist">
                      <span className="text-jade">Noted</span> — {memory}
                    </p>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        {matches.length > 0 && (
          <div className="mt-4 rise rounded-xl border border-gold/25 bg-gold/[0.06] p-3">
            <p className="mb-2 text-[0.7rem] uppercase tracking-widest text-gold">Already in your library</p>
            <div className="space-y-1.5">
              {matches.map((page) => (
                <PageChip key={page.slug} page={page} label={`${page.score}% match`} />
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-ember/35 bg-ember/10 px-3 py-2 text-[0.8rem] text-ember">
            {error}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-[57px] z-30 glass border-t border-edge">
        {mic.listening && (
          <p className="mx-auto max-w-lg px-4 pt-2 text-[0.68rem] text-mist">
            Listening — take your time. Sends after {(mic.silenceMs / 1000).toFixed(1)}s of quiet,
            or tap the mic to send now.
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
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
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
            className="max-h-[140px] flex-1 resize-none rounded-2xl border border-edge bg-abyss/70 px-3.5 py-2.5 text-[0.94rem] text-frost placeholder:text-mist/60 focus:border-arc/50 focus:outline-none"
          />

          {mic.supported && !busy && mic.listening && (
            <button
              type="button"
              onClick={mic.cancel}
              aria-label="Cancel dictation"
              className="shrink-0 rounded-full border border-edge p-3 text-mist transition-colors hover:text-ember"
            >
              <XIcon className="size-5" />
            </button>
          )}

          {mic.supported && !busy && (
            <button
              type="button"
              onClick={mic.listening ? mic.stop : startVoice}
              aria-label={mic.listening ? "Send now" : "Speak"}
              className={`relative shrink-0 rounded-full p-3 transition-colors ${
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
            className="shrink-0 rounded-full bg-arc p-3 text-void transition-opacity disabled:opacity-30"
          >
            {busy ? <StopIcon className="size-5" /> : <SendIcon className="size-5" />}
          </button>
        </form>
      </div>

      {mic.listening && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-void/92 px-8 backdrop-blur-md">
          <ReactorOrb state="listening" level={micLevel.level} className="size-64" />

          <p className="min-h-[3.5rem] max-w-sm text-center text-[1.05rem] leading-snug text-frost">
            {mic.interim || <span className="text-mist">Listening…</span>}
          </p>

          <p className="text-[0.7rem] text-mist">
            Sends after {(mic.silenceMs / 1000).toFixed(1)}s of quiet
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={mic.cancel}
              className="rounded-full border border-edge px-5 py-2.5 text-[0.8rem] text-mist transition-colors hover:text-frost"
            >
              Cancel
            </button>
            <button
              onClick={mic.stop}
              className="rounded-full bg-arc px-6 py-2.5 text-[0.8rem] font-semibold text-void"
            >
              Send now
            </button>
          </div>
        </div>
      )}

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onModelChange={setSelectedModel}
      />
    </div>
  );
}

/** "anthropic/claude-fable-5.1" -> "claude-fable-5.1" */
function shortModel(id: string): string {
  return id.split("/").pop()?.replace(/:free$/, " (free)") ?? id;
}

const TOOL_LABELS = {
  save_page: "Writing that up",
  search_pages: "Checking your library",
  update_page: "Revising the page",
  remember: "Committing to memory",
  add_task: "Adding a task",
  list_tasks: "Reading your tasks",
  log_activity: "Logging it",
  recent_activity: "Reviewing your week",
} as const;

function PageChip({ page, label }: { page: SavedPage; label: string }) {
  const Icon = PAGE_ICONS[page.pageType as keyof typeof PAGE_ICONS] ?? PAGE_ICONS.note;
  return (
    <Link
      href={`/pages/${page.slug}`}
      className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel/60 px-3 py-2.5 transition-colors hover:border-arc/40"
    >
      <Icon className="size-4 shrink-0 text-arc" />
      <span className="flex-1 truncate text-[0.85rem] font-medium">{page.title}</span>
      <span className="shrink-0 text-[0.65rem] uppercase tracking-wider text-mist">{label}</span>
    </Link>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="py-12 text-center">
      <ReactorOrb state="idle" className="mx-auto size-32" />
      <p className="mt-5 text-[0.95rem] text-frost">At your service.</p>
      <p className="mt-1 text-[0.8rem] text-mist">
        Ask for a workout or a recipe — I&apos;ll save it to a page you can come back to.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full border border-edge px-3.5 py-1.5 text-[0.78rem] text-mist transition-colors hover:border-arc/40 hover:text-frost"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
