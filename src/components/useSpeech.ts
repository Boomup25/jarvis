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

type DesktopVoiceBridge = {
  transcribeAudio: (payload: { samples: Float32Array; sampleRate: number }) => Promise<{
    ok: boolean;
    text?: string;
    error?: string;
  }>;
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

/** Electron exposes Chromium's recognizer, but its speech service is not
 * available to embedded windows on Windows. Keep this separate from the
 * mobile check so the UI can offer a browser fallback instead of blaming the
 * user's internet connection. */
export function isElectron(): boolean {
  return typeof navigator !== "undefined" && /\bElectron\/\d/i.test(navigator.userAgent);
}

function getDesktopVoiceBridge(): DesktopVoiceBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { jarvisDesktopVoice?: DesktopVoiceBridge }).jarvisDesktopVoice ?? null;
}

function downsampleAudio(input: Float32Array, fromRate: number, toRate = 16_000): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
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
      return isElectron()
        ? "The embedded Windows app cannot use its browser speech service. Open JARVIS in Chrome or Edge for microphone input."
        : "Speech recognition needs a network connection and couldn't reach the service.";
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
export function useSpeechInput(
  onFinal: (text: string) => void,
  opts?: { keepAlive?: boolean }
) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [silenceMs, setSilenceMsState] = useState(DEFAULT_SILENCE_MS);
  /** Last time speech was detected. Drives the orb where no mic analyser exists. */
  const [activityAt, setActivityAt] = useState(0);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const desktopRecorderRef = useRef<MediaRecorder | null>(null);
  const desktopStreamRef = useRef<MediaStream | null>(null);
  const desktopMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const desktopAudioContextRef = useRef<AudioContext | null>(null);
  const desktopChunksRef = useRef<Blob[]>([]);
  const desktopGenerationRef = useRef(0);
  const desktopSubmitRef = useRef(false);
  const desktopStartedAtRef = useRef(0);
  const desktopLastSoundRef = useRef(0);
  const desktopHeardRef = useRef(false);
  const desktopStartRef = useRef<(() => void) | null>(null);
  const transcriptRef = useRef("");
  const lastSoundRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const respawnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppingRef = useRef(false);
  /** Bumped on every start/stop so events from a stale instance are ignored. */
  const genRef = useRef(0);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  /**
   * True while a hands-free conversation is open.
   *
   * It changes two behaviours. The microphone respawns through silence instead
   * of only inside the send window, and the "I didn't hear anything" bail-out
   * is suppressed — in a conversation, a pause between turns is normal, and
   * ending the session is the view's decision, not the recogniser's.
   */
  const keepAliveRef = useRef(false);
  keepAliveRef.current = opts?.keepAlive ?? false;

  useEffect(() => {
    setSupported(Boolean(getRecognitionCtor() || getDesktopVoiceBridge()));
    setSilenceMsState(readSilenceMs());
    return () => {
      stoppingRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (respawnRef.current) clearTimeout(respawnRef.current);
      recRef.current?.abort();
      desktopMonitorRef.current && clearInterval(desktopMonitorRef.current);
      desktopRecorderRef.current?.stop();
      desktopStreamRef.current?.getTracks().forEach((track) => track.stop());
      void desktopAudioContextRef.current?.close();
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
    if (desktopMonitorRef.current) {
      clearInterval(desktopMonitorRef.current);
      desktopMonitorRef.current = null;
    }
    desktopSubmitRef.current = false;
    const desktopRecorder = desktopRecorderRef.current;
    desktopRecorderRef.current = null;
    if (desktopRecorder && desktopRecorder.state !== "inactive") {
      try {
        desktopRecorder.ondataavailable = null;
        desktopRecorder.onstop = null;
        desktopRecorder.stop();
      } catch {
        /* already stopped */
      }
    }
    desktopStreamRef.current?.getTracks().forEach((track) => track.stop());
    desktopStreamRef.current = null;
    void desktopAudioContextRef.current?.close();
    desktopAudioContextRef.current = null;
    desktopChunksRef.current = [];
  }, []);

  /** Desktop Electron path: record locally, detect the end of an utterance,
   * and send PCM samples to the bundled Whisper runtime through the isolated
   * preload bridge. This avoids Chromium's unsupported online recognizer. */
  const stopDesktop = useCallback((submit: boolean) => {
    const recorder = desktopRecorderRef.current;
    if (!recorder) {
      setListening(false);
      setInterim("");
      return;
    }
    desktopSubmitRef.current = submit;
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
  }, []);

  const startDesktop = useCallback(async () => {
    const bridge = getDesktopVoiceBridge();
    if (!bridge) return;

    desktopStartRef.current = startDesktop;
    teardown();
    const generation = desktopGenerationRef.current + 1;
    desktopGenerationRef.current = generation;
    setError(null);
    setInterim("Listening…");
    setListening(true);
    desktopStartedAtRef.current = Date.now();
    desktopLastSoundRef.current = Date.now();
    desktopHeardRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (desktopGenerationRef.current !== generation) return;
      setListening(false);
      setInterim("");
      setError(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone access was denied. Allow microphone access for JARVIS in Windows, then try again."
        : "JARVIS could not open the microphone.");
      return;
    }
    if (desktopGenerationRef.current !== generation) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    desktopStreamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    desktopRecorderRef.current = recorder;
    desktopChunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size) desktopChunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      if (desktopGenerationRef.current !== generation) return;
      if (desktopMonitorRef.current) {
        clearInterval(desktopMonitorRef.current);
        desktopMonitorRef.current = null;
      }
      desktopRecorderRef.current = null;
      desktopStreamRef.current?.getTracks().forEach((track) => track.stop());
      desktopStreamRef.current = null;
      void desktopAudioContextRef.current?.close();
      desktopAudioContextRef.current = null;
      // Keep the hook busy while Whisper is decoding so the conversation loop
      // does not reopen a second recorder during transcription.
      setListening(true);
      setInterim("Transcribing…");

      const shouldSubmit = desktopSubmitRef.current;
      desktopSubmitRef.current = false;
      const chunks = desktopChunksRef.current;
      desktopChunksRef.current = [];
      if (!shouldSubmit) {
        setListening(false);
        setInterim("");
        if (keepAliveRef.current) desktopStartRef.current = startDesktop;
        if (keepAliveRef.current) setTimeout(() => desktopStartRef.current?.(), 250);
        return;
      }

      try {
        const decodeContext = new AudioContext();
        const decoded = await decodeContext.decodeAudioData(await new Blob(chunks, { type: mimeType }).arrayBuffer());
        const channel = decoded.getChannelData(0);
        const mono = new Float32Array(channel);
        const samples = downsampleAudio(mono, decoded.sampleRate);
        await decodeContext.close();
        if (desktopGenerationRef.current !== generation) return;
        const result = await bridge.transcribeAudio({ samples, sampleRate: 16_000 });
        if (!result.ok) throw new Error(result.error || "No transcription returned.");
        const text = String(result.text || "").trim();
        setListening(false);
        setInterim("");
        if (text) finalRef.current(text);
        else if (keepAliveRef.current) setTimeout(() => desktopStartRef.current?.(), 250);
      } catch (error) {
        if (desktopGenerationRef.current !== generation) return;
        setListening(false);
        setInterim("");
        setError(error instanceof Error ? error.message : "Desktop transcription failed.");
      }
    };

    recorder.start(250);
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    desktopAudioContextRef.current = audioContext;
    const samples = new Uint8Array(analyser.fftSize);
    desktopMonitorRef.current = setInterval(() => {
      if (desktopGenerationRef.current !== generation || desktopRecorderRef.current !== recorder) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      if (rms > 0.035) {
        desktopHeardRef.current = true;
        desktopLastSoundRef.current = now;
        setActivityAt((prev) => (now - prev > 90 ? now : prev));
      }
      const quietFor = now - desktopLastSoundRef.current;
      const maxWait = Math.max(10_000, readSilenceMs() * 4);
      if ((desktopHeardRef.current && quietFor >= readSilenceMs()) || (!desktopHeardRef.current && now - desktopStartedAtRef.current >= maxWait)) {
        stopDesktop(desktopHeardRef.current);
      }
    }, 100);
  }, [stopDesktop, teardown]);

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
    if (isElectron() && getDesktopVoiceBridge()) {
      teardown();
      setListening(false);
      setInterim("");
      return;
    }
    finish(false);
  }, [finish, teardown]);

  const stop = useCallback(() => {
    if (isElectron() && getDesktopVoiceBridge()) {
      stopDesktop(true);
      return;
    }
    finish(true);
  }, [finish, stopDesktop]);

  const start = useCallback(() => {
    if (isElectron() && getDesktopVoiceBridge()) {
      void startDesktop();
      return;
    }
    teardown(); // Never leave a second recognizer holding the microphone.
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
          if (result.isFinal) transcriptRef.current = `${transcriptRef.current} ${result[0].transcript}`.trim();
          else live += result[0].transcript;
        }
        const now = Date.now();
        lastSoundRef.current = now;
        setInterim(live);
        // Throttled: recognition can fire many times a second and each one is
        // a React render.
        setActivityAt((prev) => (now - prev > 90 ? now : prev));
      };

      rec.onerror = (event: any) => {
        if (gen !== genRef.current) return;
        const code = String(event?.error ?? "unknown");
        // Routine: the engine heard nothing, or we aborted it ourselves.
        if (code === "no-speech" || code === "aborted") return;
        setError(explain(code));
        finish(false);
      };

      rec.onend = () => {
        if (gen !== genRef.current || stoppingRef.current) return;
        // Still inside the silence window: the browser ended the session, not
        // the user. Respawn — but give the mic a beat to actually release,
        // otherwise start() throws InvalidStateError and dictation dies.
        //
        // In a conversation we respawn regardless of how long it's been quiet,
        // because the microphone is meant to stay open between turns.
        if (keepAliveRef.current || Date.now() - lastSoundRef.current < readSilenceMs()) {
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
      // Except in a conversation, where waiting quietly is the normal state
      // between turns and the view runs its own, much longer, idle timeout.
      if (
        !keepAliveRef.current &&
        quietFor >= readSilenceMs() * 2 + 2000 &&
        !transcriptRef.current.trim()
      ) {
        setError("I didn't hear anything. Check the mic permission for this site.");
        finish(false);
      }
    }, 250);
  }, [finish, startDesktop, teardown]);

  return {
    supported,
    listening,
    interim,
    activityAt,
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
/** Small breathing space between independently synthesised sentences. */
const CHUNK_GAP_MS = 120;

/** Strip markdown so it isn't read out as punctuation soup. */
function clean(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`|>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove narrated delivery cues immediately before text reaches a voice. */
function cleanSpeech(text: string): string {
  // Models sometimes narrate delivery instead of just writing the line.
  // Strip those cues before markdown cleanup so *pauses briefly* is handled
  // as a cue rather than losing its delimiters first.
  const withoutDirections = text
    .replace(
      /\((?:[^)]*\b(?:pause|pauses|pausing|silence|silent|clears? throat|sighs?|chuckles?|laughs?|smiles?|breathes?)\b[^)]*)\)/gi,
      " "
    )
    .replace(
      /\[(?:[^\]]*\b(?:pause|pauses|pausing|silence|silent|clears? throat|sighs?|chuckles?|laughs?|smiles?|breathes?)\b[^\]]*)\]/gi,
      " "
    )
    .replace(
      /\*(?:[^*]*\b(?:pause|pauses|pausing|silence|silent|clears? throat|sighs?|chuckles?|laughs?|smiles?|breathes?)\b[^*]*)\*/gi,
      " "
    )
    .replace(/^\s*(?:pause|pauses|pausing|silence|silent|clears? throat|sighs?|chuckles?|laughs?|smiles?|breathes?)(?:\s+briefly)?\s*[,.:;-]?\s*/i, "");
  return clean(withoutDirections);
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

  /**
   * Live loudness of the reply, 0..1, for the reactor to pulse against.
   *
   * A ref rather than state on purpose: this updates every animation frame,
   * and putting it through React would re-render the whole chat view 60 times
   * a second. The orb reads it inside its own draw loop instead.
   */
  const amplitudeRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const bufferRef = useRef("");
  const consumedRef = useRef(0);
  const spokenRef = useRef(0);
  const queueRef = useRef<QueueItem[]>([]);
  const playingRef = useRef(false);

  /**
   * True from the first word of a reply until the last one has been heard.
   *
   * `speaking` alone isn't enough to answer "is JARVIS still talking?" — it
   * drops to false in the gap between two audio chunks while the next one is
   * still being synthesised, and again between the stream ending and the final
   * sentence being queued. Anything that waits for silence (the conversation
   * loop reopening the microphone, most of all) has to watch this instead, or
   * it opens the mic into the middle of a sentence.
   */
  const [pending, setPending] = useState(false);
  /** Whether a reply is still streaming in, i.e. more text may yet arrive. */
  const feedOpenRef = useRef(false);
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

  /**
   * Routes the audio element through an AnalyserNode so the reactor can pulse
   * to the real waveform instead of a synthetic sine.
   *
   * Called from unlock() because an AudioContext needs a gesture to start, and
   * because createMediaElementSource takes over the element's output — if the
   * context were left suspended, nothing would be audible at all. Any failure
   * here is swallowed: the orb just falls back to its own envelope.
   */
  const attachAnalyser = useCallback(() => {
    if (audioCtxRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;

    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;

      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;

      source.connect(analyser);
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch {
      /* CORS-tainted, unsupported, or already sourced — synthetic envelope it is */
    }
  }, []);

  /** MUST be called synchronously inside a click/tap. */
  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;

    attachAnalyser();
    void audioCtxRef.current?.resume().catch(() => {});

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
  }, [attachAnalyser]);

  // Sample the waveform while a reply plays. Only runs during speech, so
  // there's no idle animation frame burning battery between turns.
  useEffect(() => {
    if (!speaking) {
      amplitudeRef.current = 0;
      return;
    }
    const analyser = analyserRef.current;
    // Device voice has no analyser — onboundary above drives it instead, and
    // we only need to decay what that set.
    const samples = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    let raf = 0;
    const tick = () => {
      if (analyser && samples) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const v = (samples[i] - 128) / 128;
          sum += v * v;
        }
        // RMS runs quiet for speech; scale it into the orb's 0..1 range.
        const rms = Math.sqrt(sum / samples.length);
        amplitudeRef.current = Math.min(1, rms * 3.4);
      } else {
        amplitudeRef.current *= 0.9; // decay between word boundaries
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      amplitudeRef.current = 0;
    };
  }, [speaking]);

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
    feedOpenRef.current = false;
    setSpeaking(false);
    setPending(false);
  }, [reset]);

  const speakDevice = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const spoken = cleanSpeech(text);
    if (!spoken) return;
    const utterance = new SpeechSynthesisUtterance(spoken);
    if (voiceRef.current) utterance.voice = voiceRef.current;
    // Keep the fallback close to the local LuxTTS pace. Some browsers ignore
    // a voice preference but still honour the rate.
    utterance.rate = 0.88;
    utterance.pitch = 0.92;
    const settle = () => {
      setSpeaking(false);
      amplitudeRef.current = 0;
      // The reply is over only when nothing is queued and no more text is
      // coming — the browser keeps its own utterance queue behind this.
      if (!feedOpenRef.current && !speechSynthesis.pending && !speechSynthesis.speaking) {
        setPending(false);
      }
    };

    utterance.onstart = () => {
      setSpeaking(true);
      setPending(true);
    };
    utterance.onend = settle;
    utterance.onerror = settle;
    // speechSynthesis exposes no waveform, but it does fire on each word.
    // Kicking the amplitude per word gives the orb a real speech rhythm
    // rather than a sine that ignores what's being said.
    utterance.onboundary = () => {
      amplitudeRef.current = 0.55 + Math.random() * 0.3;
    };
    speechSynthesis.speak(utterance);
  }, []);

  /** Fire synthesis immediately; the queue awaits the result when its turn comes. */
  const synthesise = useCallback((text: string, gen: number): Promise<string | null> => {
    const spoken = cleanSpeech(text);
    if (!spoken) return Promise.resolve(null);
    const controller = new AbortController();
    controllersRef.current.push(controller);

    return fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken }),
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
      // Only truly finished once no more text is coming. While the reply is
      // still streaming, an empty queue just means we're waiting on the next
      // chunk's synthesis.
      if (!feedOpenRef.current) setPending(false);
      return;
    }

    playingRef.current = true;
    setSpeaking(true);
    setPending(true);

    void item.audio.then((url) => {
      if (gen !== genRef.current) return;
      if (!url) {
        // This chunk fell back to the device voice; move on.
        playNext();
        return;
      }
      audio.src = url;
      audio.onended = () => {
        if (gen === genRef.current) window.setTimeout(() => playNext(), CHUNK_GAP_MS);
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
    // The stream is over, so an empty queue from here on really is the end.
    feedOpenRef.current = false;
    if (!enabledRef.current) {
      setPending(false);
      return;
    }
    if (spokenRef.current >= SPEAK_BUDGET) {
      if (!playingRef.current && queueRef.current.length === 0) setPending(false);
      return;
    }
    const [chunk] = takeChunk(bufferRef.current, true);
    bufferRef.current = "";
    if (!chunk) {
      if (!playingRef.current && queueRef.current.length === 0) setPending(false);
      return;
    }
    spokenRef.current += chunk.length;
    if (modeRef.current === "device") speakDevice(chunk);
    else enqueue(chunk);
  }, [enqueue, speakDevice]);

  /** Start of a new reply. */
  const startFeed = useCallback(() => {
    shutUp();
    setError(null);
    if (enabledRef.current) {
      // Claim the floor for the whole reply up front. Without this there's a
      // window between the first token arriving and the first audio chunk
      // being ready where nothing looks busy.
      feedOpenRef.current = true;
      setPending(true);
    }
  }, [shutUp]);

  /** One-shot, for the settings preview. */
  const speak = useCallback(
    (raw: string) => {
      if (!enabledRef.current) return;
      const text = cleanSpeech(raw).slice(0, SPEAK_BUDGET);
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
    /** Still mid-reply, including the gaps between audio chunks. */
    pending,
    error,
    toggle,
    speak,
    startFeed,
    feed,
    endFeed,
    shutUp,
    unlock,
    /** Live loudness of the reply, 0..1. Read inside animation loops only. */
    amplitudeRef,
  };
}
