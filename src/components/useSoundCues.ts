"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SoundCueKind = "sessionStart" | "acknowledge" | "complete" | "error" | "input" | "resource" | "spam";

const CUES: Record<SoundCueKind, string[]> = {
  sessionStart: [1, 2, 3, 4, 5].map((n) => `/audio/jarvis/session_start_${n}.mp3`),
  acknowledge: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `/audio/jarvis/acknowledge_${n}.mp3`),
  complete: [1, 2, 3, 4, 5, 6, 7].map((n) => `/audio/jarvis/complete_${n}.mp3`),
  error: [1, 2, 3, 4, 5, 6, 7].map((n) => `/audio/jarvis/error_${n}.mp3`),
  input: Array.from({ length: 28 }, (_, i) => `/audio/jarvis/input_${i + 1}.mp3`),
  resource: [1, 2, 3, 4, 5].map((n) => `/audio/jarvis/resource_${n}.mp3`),
  spam: [1, 2, 3, 4, 5, 6].map((n) => `/audio/jarvis/spam_${n}.mp3`),
};

function choose(kind: SoundCueKind): string {
  const options = CUES[kind];
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Small, serialized JARVIS sound effects. Playback is deliberately separate
 * from TTS so a cue can replace a long “I’m opening that now…” reply without
 * changing the normal voice experience.
 */
export function useSoundCues(enabled: boolean) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const blockedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [pending, setPending] = useState(false);

  const playNext = useCallback(() => {
    if (!enabledRef.current || playingRef.current || blockedRef.current) return;
    const url = queueRef.current.shift();
    if (!url || typeof window === "undefined") return;

    const audio = new Audio(url);
    audio.preload = "auto";
    audioRef.current = audio;
    playingRef.current = true;

    const finish = () => {
      if (audioRef.current === audio) audioRef.current = null;
      playingRef.current = false;
      if (queueRef.current.length === 0) setPending(false);
      window.setTimeout(playNext, 45);
    };
    audio.onended = finish;
    audio.onerror = finish;
    void audio.play().catch(() => {
      // Browsers may block the page-load cue until the first tap or keypress.
      // Keep it queued and replay it from unlock() after that gesture.
      playingRef.current = false;
      blockedRef.current = true;
      queueRef.current.unshift(url);
      setPending(true);
      audio.pause();
    });
  }, []);

  const playCue = useCallback((kind: SoundCueKind) => {
    if (!enabledRef.current) return;
    // A short cap keeps a burst of tool events from becoming a wall of beeps.
    if (queueRef.current.length >= 2) return;
    queueRef.current.push(choose(kind));
    setPending(true);
    playNext();
  }, [playNext]);

  const unlock = useCallback(() => {
    blockedRef.current = false;
    playNext();
  }, [playNext]);

  const clear = useCallback(() => {
    queueRef.current = [];
    blockedRef.current = false;
    const audio = audioRef.current;
    audio?.pause();
    audioRef.current = null;
    playingRef.current = false;
    setPending(false);
  }, []);

  useEffect(() => {
    if (!enabled) clear();
  }, [enabled, clear]);

  useEffect(() => clear, [clear]);

  return useMemo(() => ({ playCue, unlock, clear, pending }), [playCue, unlock, clear, pending]);
}
