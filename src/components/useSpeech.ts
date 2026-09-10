"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* The Web Speech API is still vendor-prefixed in Chrome and absent on desktop
   Firefox, so everything here degrades to "button just doesn't show". */

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
 * The browser's default behaviour (continuous = false) submits at the first
 * pause, which cuts you off mid-sentence. Instead we run in continuous mode,
 * accumulate the transcript ourselves, and only submit after a genuine stretch
 * of silence. Chrome also ends the session on its own every few seconds — we
 * restart it transparently so a thinking pause doesn't end the recording.
 */
export function useSpeechInput(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [silenceMs, setSilenceMsState] = useState(DEFAULT_SILENCE_MS);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const lastSoundRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => {
    setSupported(Boolean(getRecognitionCtor()));
    setSilenceMsState(readSilenceMs());
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stoppingRef.current = true;
      recRef.current?.abort();
    };
  }, []);

  const setSilenceMs = useCallback((ms: number) => {
    setSilenceMsState(ms);
    writeSilenceMs(ms);
  }, []);

  const finish = useCallback((submit: boolean) => {
    stoppingRef.current = true;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    setInterim("");

    const text = transcriptRef.current.trim();
    transcriptRef.current = "";
    if (submit && text) finalRef.current(text);
  }, []);

  /** Cancel without submitting. */
  const cancel = useCallback(() => finish(false), [finish]);
  /** Submit whatever has been said so far, immediately. */
  const stop = useCallback(() => finish(true), [finish]);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    transcriptRef.current = "";
    lastSoundRef.current = Date.now();
    stoppingRef.current = false;
    setInterim("");
    setListening(true);

    const spawn = () => {
      const rec = new Ctor();
      rec.lang = navigator.language || "en-US";
      rec.continuous = true;
      rec.interimResults = true;

      rec.onresult = (event: any) => {
        let live = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) transcriptRef.current += result[0].transcript;
          else live += result[0].transcript;
        }
        // Any speech at all — final or interim — resets the silence clock.
        lastSoundRef.current = Date.now();
        setInterim(live);
      };

      rec.onerror = (event: any) => {
        // "no-speech" and "aborted" are routine; anything else is fatal.
        if (event?.error && event.error !== "no-speech" && event.error !== "aborted") {
          finish(true);
        }
      };

      rec.onend = () => {
        // Chrome ends the session on its own after a few seconds of quiet.
        // If the user hasn't stopped and the silence window hasn't elapsed,
        // start a fresh one so a pause to think doesn't end the recording.
        if (stoppingRef.current) return;
        if (Date.now() - lastSoundRef.current < readSilenceMs()) {
          try {
            spawn();
          } catch {
            finish(true);
          }
        }
      };

      recRef.current = rec;
      try {
        rec.start();
      } catch {
        /* already running */
      }
    };

    spawn();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const quietFor = Date.now() - lastSoundRef.current;
      if (quietFor >= readSilenceMs() && transcriptRef.current.trim()) {
        finish(true);
      }
      // Nothing said at all after twice the window — give up silently.
      if (quietFor >= readSilenceMs() * 2 && !transcriptRef.current.trim()) {
        finish(false);
      }
    }, 250);
  }, [finish]);

  return { supported, listening, interim, start, stop, cancel, silenceMs, setSilenceMs };
}

const VOICE_PREF_KEY = "jarvis:voice";

export function useSpeechOutput() {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    try {
      setEnabled(localStorage.getItem(VOICE_PREF_KEY) === "on");
    } catch {
      /* storage blocked — default off */
    }

    const pick = () => {
      const voices = speechSynthesis.getVoices();
      if (!voices.length) return;
      // A calm British male voice is as close to the source material as the
      // browser gets for free.
      voiceRef.current =
        voices.find((v) => /en-GB/i.test(v.lang) && /(daniel|male|arthur|george)/i.test(v.name)) ??
        voices.find((v) => /en-GB/i.test(v.lang)) ??
        voices.find((v) => /en-US/i.test(v.lang)) ??
        voices[0];
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
    return () => {
      speechSynthesis.onvoiceschanged = null;
      speechSynthesis.cancel();
    };
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(VOICE_PREF_KEY, next ? "on" : "off");
      } catch {
        /* ignore */
      }
      if (!next && typeof window !== "undefined") speechSynthesis.cancel();
      return next;
    });
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const clean = text
        .replace(/```[\s\S]*?```/g, " code block ")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[#*_`|>-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 900);
      if (!clean) return;

      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.rate = 1.02;
      utterance.pitch = 0.92;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      speechSynthesis.speak(utterance);
    },
    [enabled]
  );

  const shutUp = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { enabled, supported, speaking, toggle, speak, shutUp };
}
