"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEMO_DASHBOARD, DEMO_MAX_CHARS } from "@/lib/demo";
import { DemoGallery } from "./DemoGallery";

type DemoMessage = { role: "user" | "assistant"; text: string };

const STARTER: DemoMessage = {
  role: "assistant",
  text: "Good day. I’m JARVIS, running in a secure public demo. Ask me anything to see how I can help.",
};

export function DemoView() {
  const [messages, setMessages] = useState<DemoMessage[]>([STARTER]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);

  useEffect(() => {
    setVoiceSupported(typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
  }, []);

  function speakLocally(text: string) {
    if (!voiceEnabled || !voiceSupported || !text.trim()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 900));
    const voices = synth.getVoices();
    utterance.voice =
      voices.find((voice) => /en-GB/i.test(voice.lang) && /(daniel|arthur|george|oliver)/i.test(voice.name)) ??
      voices.find((voice) => /en-GB/i.test(voice.lang)) ??
      voices.find((voice) => /en-US/i.test(voice.lang)) ??
      voices[0] ?? null;
    utterance.rate = 0.98;
    utterance.pitch = 0.88;
    synth.speak(utterance);
  }

  function toggleVoice() {
    if (!voiceSupported) return;
    if (voiceEnabled) window.speechSynthesis.cancel();
    else {
      const unlock = new SpeechSynthesisUtterance(" ");
      unlock.volume = 0;
      window.speechSynthesis.speak(unlock);
    }
    setVoiceEnabled((enabled) => !enabled);
  }

  async function sendMessage(raw?: string) {
    const text = (raw ?? input).trim().slice(0, DEMO_MAX_CHARS);
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);

    try {
      const response = await fetch("/api/demo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "The demo is unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type?: string; delta?: string; message?: string };
          if (event.type === "text" && event.delta) {
            assistantText += event.delta;
            setMessages((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, text: last.text + event.delta };
              return next;
            });
          } else if (event.type === "error") {
            throw new Error(event.message || "The demo is unavailable.");
          }
        }
      }
      speakLocally(assistantText);
    } catch (err) {
      setMessages((current) => current.slice(0, -1));
      setError(err instanceof Error ? err.message : "The demo is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto px-4 py-6 sm:px-6">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="readout text-arc">PUBLIC DEMO</p>
          <h1 className="mt-1 text-xl font-semibold tracking-[0.25em]">JARVIS</h1>
        </div>
        <Link href="/login" className="readout text-arc hover:underline">Sign in</Link>
      </header>

      <div className="mb-4 border border-edge bg-void/40 px-4 py-3 text-xs text-mist">
        No account data, tools, computer access, or saved history are available here. Messages are limited and handled by one fast free model.
      </div>

      <section className="mb-5 border border-edge bg-void/30 p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="readout text-arc">DEMO DASHBOARD · SAMPLE DATA</p>
            <h2 className="mt-1 text-lg font-semibold">Good morning, {DEMO_DASHBOARD.displayName}.</h2>
            <p className="mt-1 text-xs text-mist">{DEMO_DASHBOARD.date}</p>
          </div>
          <button
            type="button"
            onClick={toggleVoice}
            disabled={!voiceSupported}
            className="border border-edge px-3 py-2 text-xs text-mist transition-colors hover:border-arc/60 hover:text-arc disabled:opacity-40"
            title="Uses your browser's local British voice. Nothing is sent or saved."
          >
            {voiceEnabled ? "Voice on" : "Hear JARVIS"}
          </button>
        </div>
        <p className="border-l border-arc/60 pl-3 text-sm leading-6 text-frost">{DEMO_DASHBOARD.greeting}</p>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["This week", DEMO_DASHBOARD.stats.sessions],
            ["Day streak", `${DEMO_DASHBOARD.stats.streak}d`],
            ["Pages", DEMO_DASHBOARD.stats.pages],
            ["Memories", DEMO_DASHBOARD.stats.memories],
          ].map(([label, value]) => (
            <div key={label} className="border border-edge bg-panel/40 px-3 py-3">
              <p className="readout text-mist">{label}</p>
              <p className="mt-1 text-xl font-semibold text-arc">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="readout text-mist">OPEN TASKS</p>
            <ul className="mt-2 space-y-2">
              {DEMO_DASHBOARD.tasks.map((task) => (
                <li key={task.title} className="flex items-center justify-between gap-3 border border-edge px-3 py-2 text-xs">
                  <span>{task.title}</span><span className="shrink-0 text-mist">{task.due}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="readout text-mist">RECENT PAGES</p>
            <ul className="mt-2 space-y-2">
              {DEMO_DASHBOARD.pages.map((page) => (
                <li key={page.title} className="flex items-center justify-between gap-3 border border-edge px-3 py-2 text-xs">
                  <span>{page.title}</span><span className="shrink-0 text-arc">{page.type}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-5 text-xs leading-5 text-mist"><span className="text-arc">JARVIS insight:</span> {DEMO_DASHBOARD.insight}</p>
      </section>

      <DemoGallery />

      <section className="min-h-[16rem] flex-1 space-y-4 overflow-y-auto border border-edge bg-void/30 p-4" aria-live="polite">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-[85%]" : "max-w-[85%]"}>
            <p className="readout mb-1 text-mist/60">{message.role === "user" ? "YOU" : "JARVIS"}</p>
            <p className={`whitespace-pre-wrap px-3 py-2 text-sm leading-6 ${message.role === "user" ? "bg-arc/10 text-frost" : "border border-edge text-frost"}`}>
              {message.text || (busy && index === messages.length - 1 ? "…" : "")}
            </p>
          </div>
        ))}
      </section>

      {error && <p className="mt-3 text-xs text-ember">{error}</p>}

      <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value.slice(0, DEMO_MAX_CHARS))}
          placeholder="Ask JARVIS something…"
          maxLength={DEMO_MAX_CHARS}
          disabled={busy}
          className="min-w-0 flex-1 border border-edge bg-void/60 px-4 py-3 text-sm text-frost placeholder:text-mist/50 focus:border-arc/60 focus:outline-none disabled:opacity-50"
        />
        <button type="submit" disabled={busy || !input.trim()} className="notch-tr bg-arc px-5 text-sm font-semibold text-void transition-opacity disabled:opacity-40">
          {busy ? "…" : "Send"}
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {["Give me a quick productivity tip", "Explain quantum computing simply"].map((prompt) => (
          <button key={prompt} type="button" onClick={() => void sendMessage(prompt)} disabled={busy} className="border border-edge px-3 py-2 text-xs text-mist transition-colors hover:border-arc/60 hover:text-arc disabled:opacity-40">
            {prompt}
          </button>
        ))}
      </div>
    </main>
  );
}
