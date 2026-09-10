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

/** Total characters spoken per reply. Long pages are never read aloud. */
const SPEAK_BUDGET = 900;
/** Don't synthesise fragments shorter than this — the per-request overhead dominates. */
const MIN_CHUNK = 70;
/** The FIRST chunk gets a lower bar: starting to speak sooner matters more
 *  than request efficiency, and openers ("Good evening, sir.") are short. */
const MIN_FIRST_CHUNK = 12;
/** Force a break here even mid-sentence, so one long run-on can't stall the audio. */
const MAX_CHUNK = 240;

/** Strip markdown so it isn't read out as punctuation soup. */
function clean(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`|>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull one speakable chunk off the front of the buffer, or null if the buffer
 * doesn't yet hold a natural stopping point.
 */
function takeChunk(buffer: string, flush: boolean, minLen = MIN_CHUNK): [string | null, string] {
  const trimmed = buffer.replace(/^\s+/, "");
  if (!trimmed) return [null, ""];

  if (flush) return [trimmed, ""];
  if (trimmed.length < minLen) return [null, trimmed];

  for (let i = minLen; i < trimmed.length && i <= MAX_CHUNK; i++) {
    const c = trimmed[i];
    if (c === "." || c === "!" || c === "?" || c === "\n") {
      const next = trimmed[i + 1];
      if (next === undefined || next === " " || next === "\n") {
        return [trimmed.slice(0, i + 1).trim(), trimmed.slice(i + 1)];
      }
    }
  }

  if (trimmed.length > MAX_CHUNK) {
    const space = trimmed.lastIndexOf(" ", MAX_CHUNK);
    const at = space > minLen ? space : MAX_CHUNK;
    return [trimmed.slice(0, at).trim(), trimmed.slice(at)];
  }

  return [null, trimmed];
}

interface QueueItem {
  text: string;
  /** Synthesis starts the moment the chunk is queued, not when it's its turn. */
  audio: Promise<string | null>;
}

/**
 * Spoken replies.
 *
 * Streamed, not batched. Chunks are cut at sentence boundaries as the reply
 * arrives, synthesis for chunk N+1 runs while chunk N is playing, and playback
 * starts as soon as the FIRST sentence is ready — rather than after the whole
 * reply has finished, been synthesised, and been downloaded.
 *
 * Both paths need unlocking from a real user gesture on iOS: an <audio> element
 * must have played once before it can be re-sourced programmatically, and
 * speechSynthesis refuses entirely until its first gesture-triggered utterance.
 */
export function useSpeechOutput() {
  const [enabled, setEnabled] = useState(false);
  const [mode, setModeState] = useState<VoiceMode>("natural");
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);

  const bufferRef = useRef("");
  const consumedRef = useRef(0);
  const spokenRef = useRef(0);
  const queueRef = useRef<QueueItem[]>([]);
  const playingRef = useRef(false);
  const urlsRef = useRef<string[]>([]);
  const controllersRef = useRef<AbortController[]>([]);
  const genRef = useRef(0);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const modeRef = useRef(mode);
  modeRef.current = mode;

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
    // the physical silent switch is on. Experimental and Safari-only.
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = "playback";
    } catch {
      /* not supported */
    }

    const audio = new Audio();
    audio.preload = "auto";
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
      audio.pause();
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  /** MUST be called synchronously inside a click/tap. */
  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;

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

  const reset = useCallback(() => {
    genRef.current++;
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current = [];
    queueRef.current = [];
    playingRef.current = false;
    bufferRef.current = "";
    consumedRef.current = 0;
    spokenRef.current = 0;
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
  }, []);

  const shutUp = useCallback(() => {
    reset();
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
    }
    setSpeaking(false);
  }, [reset]);

  const speakDevice = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = 1.02;
    utterance.pitch = 0.92;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    speechSynthesis.speak(utterance);
  }, []);

  /** Fire synthesis immediately; the queue awaits the result when its turn comes. */
  const synthesise = useCallback((text: string, gen: number): Promise<string | null> => {
    const controller = new AbortController();
    controllersRef.current.push(controller);

    return fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error || `speak failed (${res.status})`);
        }
        const url = URL.createObjectURL(await res.blob());
        urlsRef.current.push(url);
        return url;
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError" || gen !== genRef.current) return null;
        setError(
          `Natural voice unavailable — ${(err as Error).message.slice(0, 200)}. Using the device voice.`
        );
        speakDevice(text);
        return null;
      });
  }, [speakDevice]);

  const playNext = useCallback(() => {
    const gen = genRef.current;
    const audio = audioRef.current;
    if (!audio) return;

    const item = queueRef.current.shift();
    if (!item) {
      playingRef.current = false;
      setSpeaking(false);
      return;
    }

    playingRef.current = true;
    setSpeaking(true);

    void item.audio.then((url) => {
      if (gen !== genRef.current) return;
      if (!url) {
        // This chunk fell back to the device voice; move on.
        playNext();
        return;
      }
      audio.src = url;
      audio.onended = () => {
        if (gen === genRef.current) playNext();
      };
      audio.onerror = () => {
        if (gen === genRef.current) playNext();
      };
      void audio.play().catch(() => {
        if (gen === genRef.current) playNext();
      });
    });
  }, []);

  const enqueue = useCallback(
    (text: string) => {
      const gen = genRef.current;
      queueRef.current.push({ text, audio: synthesise(text, gen) });
      if (!playingRef.current) playNext();
    },
    [synthesise, playNext]
  );

  /** Called on each streamed delta with the FULL text so far. */
  const feed = useCallback(
    (fullText: string) => {
      if (!enabledRef.current) return;
      if (spokenRef.current >= SPEAK_BUDGET) return;

      const cleaned = clean(fullText);
      if (cleaned.length <= consumedRef.current) return;

      bufferRef.current += cleaned.slice(consumedRef.current);
      consumedRef.current = cleaned.length;

      while (spokenRef.current < SPEAK_BUDGET) {
        const first = spokenRef.current === 0;
        const [chunk, rest] = takeChunk(bufferRef.current, false, first ? MIN_FIRST_CHUNK : MIN_CHUNK);
        if (!chunk) break;
        bufferRef.current = rest;
        spokenRef.current += chunk.length;
        if (modeRef.current === "device") speakDevice(chunk);
        else enqueue(chunk);
      }
    },
    [enqueue, speakDevice]
  );

  /** Called once the reply has finished streaming. */
  const endFeed = useCallback(() => {
    if (!enabledRef.current) return;
    if (spokenRef.current >= SPEAK_BUDGET) return;
    const [chunk] = takeChunk(bufferRef.current, true);
    bufferRef.current = "";
    if (!chunk) return;
    spokenRef.current += chunk.length;
    if (modeRef.current === "device") speakDevice(chunk);
    else enqueue(chunk);
  }, [enqueue, speakDevice]);

  /** Start of a new reply. */
  const startFeed = useCallback(() => {
    shutUp();
    setError(null);
  }, [shutUp]);

  /** One-shot, for the settings preview. */
  const speak = useCallback(
    (raw: string) => {
      if (!enabledRef.current) return;
      const text = clean(raw).slice(0, SPEAK_BUDGET);
      if (!text) return;
      shutUp();
      setError(null);
      if (modeRef.current === "device") speakDevice(text);
      else enqueue(text);
    },
    [shutUp, speakDevice, enqueue]
  );

  const setMode = useCallback(
    (next: VoiceMode) => {
      setModeState(next);
      try {
        localStorage.setItem(VOICE_MODE_KEY, next);
      } catch {
        /* ignore */
      }
      shutUp();
    },
    [shutUp]
  );

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(VOICE_PREF_KEY, next ? "on" : "off");
      } catch {
        /* ignore */
      }
      if (next) unlock();
      else shutUp();
      return next;
    });
  }, [unlock, shutUp]);

  return {
    enabled,
    mode,
    setMode,
    supported,
    speaking,
    error,
    toggle,
    speak,
    startFeed,
    feed,
    endFeed,
    shutUp,
    unlock,
  };
}
