"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* The Web Speech API is vendor-prefixed, absent on desktop Firefox, and on iOS
   Safari it exists but fails in ways that used to be invisible here. Every exit
   path now reports a reason. */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIOS() || /Android/i.test(navigator.userAgent);
}

/** Turn a SpeechRecognition error code into something a human can act on. */
function explain(code: string): string {
  switch (code) {
    case "not-allowed":
      return isIOS()
        ? "Microphone access is off. Settings → Safari → Microphone → Allow, then reload."
        : "Microphone access was denied. Allow it in your browser's site settings.";
    case "service-not-allowed":
      return isIOS()
        ? "iOS blocked the speech service. Use the mic key on your keyboard instead — it types straight into the box."
        : "The browser blocked its speech service.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs a network connection and couldn't reach the service.";
    case "language-not-supported":
      return "Your device doesn't have a voice model for this language.";
    default:
      return `Speech recognition failed (${code}).`;
  }
}

export const SILENCE_KEY = "jarvis:speechSilenceMs";
export const DEFAULT_SILENCE_MS = 2500;

export function readSilenceMs(): number {
  if (typeof window === "undefined") return DEFAULT_SILENCE_MS;
  try {
    const raw = Number(localStorage.getItem(SILENCE_KEY));
    if (Number.isFinite(raw) && raw >= 500 && raw <= 10_000) return raw;
  } catch {
    /* storage blocked */
  }
  return DEFAULT_SILENCE_MS;
}

export function writeSilenceMs(ms: number) {
  try {
    localStorage.setItem(SILENCE_KEY, String(ms));
  } catch {
    /* storage blocked */
  }
}

/**
 * Dictation that waits for you to actually finish.
 *
 * Continuous mode plus our own silence timer, so a pause mid-sentence doesn't
 * submit. Chrome (and iOS, harder) ends the session on its own; we respawn it,
 * but only one instance may exist at a time and only after the previous one has
 * released the microphone — respawning instantly is what made this flaky.
 */
export function useSpeechInput(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [silenceMs, setSilenceMsState] = useState(DEFAULT_SILENCE_MS);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const lastSoundRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const respawnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppingRef = useRef(false);
  /** Bumped on every start/stop so events from a stale instance are ignored. */
  const genRef = useRef(0);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => {
    setSupported(Boolean(getRecognitionCtor()));
    setSilenceMsState(readSilenceMs());
    return () => {
      stoppingRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (respawnRef.current) clearTimeout(respawnRef.current);
      recRef.current?.abort();
    };
  }, []);

  const setSilenceMs = useCallback((ms: number) => {
    setSilenceMsState(ms);
    writeSilenceMs(ms);
  }, []);

  const teardown = useCallback(() => {
    genRef.current++;
    stoppingRef.current = true;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (respawnRef.current) {
      clearTimeout(respawnRef.current);
      respawnRef.current = null;
    }
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      // Detach first — a stopping instance still fires onend.
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* already dead */
      }
    }
  }, []);

  const finish = useCallback(
    (submit: boolean) => {
      teardown();
      setListening(false);
      setInterim("");
      const text = transcriptRef.current.trim();
      transcriptRef.current = "";
      if (submit && text) finalRef.current(text);
    },
    [teardown]
  );

  const cancel = useCallback(() => {
    setError(null);
    finish(false);
  }, [finish]);

  const stop = useCallback(() => finish(true), [finish]);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError(
        isIOS()
          ? "This browser has no speech recognition. Use the mic key on your keyboard — it types into the box."
          : "This browser doesn't support speech recognition."
      );
      return;
    }

    setError(null);
    transcriptRef.current = "";
    lastSoundRef.current = Date.now();
    stoppingRef.current = false;
    genRef.current++;
    const gen = genRef.current;
    setInterim("");
    setListening(true);

    const spawn = () => {
      if (stoppingRef.current || gen !== genRef.current) return;

      const rec = new Ctor();
      rec.lang = navigator.language || "en-US";
      // iOS Safari's continuous mode is broken — it ends the session
      // immediately. Single-shot plus our respawn loop is what works there.
      rec.continuous = !isIOS();
      rec.interimResults = true;

      rec.onresult = (event: any) => {
        if (gen !== genRef.current) return;
        let live = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) transcriptRef.current += result[0].transcript;
          else live += result[0].transcript;
        }
        lastSoundRef.current = Date.now();
        setInterim(live);
      };

      rec.onerror = (event: any) => {
        if (gen !== genRef.current) return;
        const code = String(event?.error ?? "unknown");
        // Routine: the engine heard nothing, or we aborted it ourselves.
        if (code === "no-speech" || code === "aborted") return;
        setError(explain(code));
        finish(Boolean(transcriptRef.current.trim()));
      };

      rec.onend = () => {
        if (gen !== genRef.current || stoppingRef.current) return;
        // Still inside the silence window: the browser ended the session, not
        // the user. Respawn — but give the mic a beat to actually release,
        // otherwise start() throws InvalidStateError and dictation dies.
        if (Date.now() - lastSoundRef.current < readSilenceMs()) {
          respawnRef.current = setTimeout(spawn, 250);
        }
      };

      recRef.current = rec;
      try {
        rec.start();
      } catch {
        // Almost always InvalidStateError from an instance that hasn't
        // released yet. One retry, then give up loudly rather than silently.
        respawnRef.current = setTimeout(() => {
          if (stoppingRef.current || gen !== genRef.current) return;
          try {
            rec.start();
          } catch {
            setError("Couldn't start the microphone. Try again.");
            finish(false);
          }
        }, 350);
      }
    };

    spawn();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (gen !== genRef.current) return;
      const quietFor = Date.now() - lastSoundRef.current;
      if (quietFor >= readSilenceMs() && transcriptRef.current.trim()) {
        finish(true);
      }
      // Nothing heard at all after twice the window — stop, and say why.
      if (quietFor >= readSilenceMs() * 2 + 2000 && !transcriptRef.current.trim()) {
        setError("I didn't hear anything. Check the mic permission for this site.");
        finish(false);
      }
    }, 250);
  }, [finish]);

  return {
    supported,
    listening,
    interim,
    error,
    clearError: () => setError(null),
    start,
    stop,
    cancel,
    silenceMs,
    setSilenceMs,
  };
}

const VOICE_PREF_KEY = "jarvis:voice";
const VOICE_MODE_KEY = "jarvis:voiceMode";

/** 0.05s of silence. Playing this inside a tap is what unlocks audio on iOS. */
const SILENT_WAV = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

export type VoiceMode = "natural" | "device";

/**
 * Spoken replies.
 *
 * Two paths. "natural" hits /api/speak, which proxies OpenRouter's TTS and
 * streams mp3 back — the key stays server-side. "device" uses the browser's
 * own speechSynthesis, which is free but sounds like a phone.
 *
 * Both need unlocking from a real user gesture on iOS: an <audio> element must
 * have played once before it can be re-sourced programmatically, and
 * speechSynthesis refuses entirely until its first gesture-triggered utterance.
 * That is why nothing was ever spoken on iPhone before.
 */
export function useSpeechOutput() {
  const [enabled, setEnabled] = useState(false);
  const [mode, setModeState] = useState<VoiceMode>("natural");
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const unlockedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSupported(true);

    try {
      setEnabled(localStorage.getItem(VOICE_PREF_KEY) === "on");
      const saved = localStorage.getItem(VOICE_MODE_KEY);
      if (saved === "device" || saved === "natural") setModeState(saved);
    } catch {
      /* storage blocked */
    }

    // Declare this as media playback rather than incidental sound. On iOS this
    // maps to AVAudioSession .playback, which is what lets audio through when
    // the physical silent switch is on. Experimental and Safari-only — feature
    // detected, and harmless where it is missing.
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = "playback";
    } catch {
      /* not supported */
    }

    const audio = new Audio();
    audio.preload = "auto";
    audio.onplay = () => setSpeaking(true);
    audio.onended = () => setSpeaking(false);
    audio.onpause = () => setSpeaking(false);
    audio.onerror = () => setSpeaking(false);
    audioRef.current = audio;

    if ("speechSynthesis" in window) {
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        if (!voices.length) return;
        voiceRef.current =
          voices.find((v) => /en-GB/i.test(v.lang) && /(daniel|arthur|george|oliver)/i.test(v.name)) ??
          voices.find((v) => /en-GB/i.test(v.lang)) ??
          voices.find((v) => /en-US/i.test(v.lang)) ??
          voices[0];
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }

    return () => {
      if ("speechSynthesis" in window) {
        speechSynthesis.onvoiceschanged = null;
        speechSynthesis.cancel();
      }
      abortRef.current?.abort();
      audio.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  /** MUST be called synchronously inside a click/tap. */
  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;

    // Re-assert on the gesture too — Safari can reset it between page states.
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = "playback";
    } catch {
      /* not supported */
    }

    const audio = audioRef.current;
    if (audio) {
      try {
        audio.src = SILENT_WAV;
        void audio.play().catch(() => {});
      } catch {
        /* ignore */
      }
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        const silent = new SpeechSynthesisUtterance(" ");
        silent.volume = 0;
        speechSynthesis.speak(silent);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const shutUp = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
    audioRef.current?.pause();
    setSpeaking(false);
  }, []);

  const setMode = useCallback((next: VoiceMode) => {
    setModeState(next);
    try {
      localStorage.setItem(VOICE_MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(VOICE_PREF_KEY, next ? "on" : "off");
      } catch {
        /* ignore */
      }
      if (next) unlock(); // runs inside the tap, which is the whole point
      else shutUp();
      return next;
    });
  }, [unlock, shutUp]);

  /** Strip markdown so it isn't read out as punctuation soup. */
  const clean = (text: string) =>
    text
      .replace(/```[\s\S]*?```/g, " code block ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#*_`|>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 900);

  const speakDevice = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = 1.02;
    utterance.pitch = 0.92;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(
    async (raw: string) => {
      if (!enabled) return;
      const text = clean(raw);
      if (!text) return;

      setError(null);

      if (mode === "device") {
        speakDevice(text);
        return;
      }

      const audio = audioRef.current;
      if (!audio) return speakDevice(text);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setSpeaking(true);
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error || `speak failed (${res.status})`);
        }

        const blob = await res.blob();
        if (controller.signal.aborted) return;

        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        audio.src = urlRef.current;
        await audio.play();
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setSpeaking(false);
        // Never go silent because the API had a bad day.
        // Show what actually went wrong. A generic message here cost hours.
        setError(
          `Natural voice unavailable — ${(err as Error).message.slice(0, 200)}. Using the device voice.`
        );
        speakDevice(text);
      }
    },
    [enabled, mode, speakDevice]
  );

  return { enabled, mode, setMode, supported, speaking, error, toggle, speak, shutUp, unlock };
}
