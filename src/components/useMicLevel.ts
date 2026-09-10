"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isMobile } from "./useSpeech";

/**
 * Live microphone loudness, 0..1, purely to drive the orb.
 *
 * DESKTOP ONLY, deliberately. This opens a second getUserMedia stream
 * alongside SpeechRecognition. On desktop the two coexist; on iOS they fight
 * over the microphone, and iOS re-prompts for permission on every page load —
 * so on a phone this cosmetic stream was costing a permission dialog per
 * session and stealing the mic from the thing that actually matters.
 *
 * On mobile it reports inactive and the orb falls back to its own envelope.
 */
export function useMicLevel() {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);
  const [available, setAvailable] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const levelRef = useRef(0);

  useEffect(() => {
    setAvailable(!isMobile() && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    levelRef.current = 0;
    setLevel(0);
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    if (isMobile()) return; // never contend for the mic on a phone
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    if (streamRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new Ctx();
      ctxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      setActive(true);

      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const scaled = Math.min(1, rms * 4.5);
        // Fast attack, slow release — responsive without flickering.
        levelRef.current =
          scaled > levelRef.current
            ? levelRef.current + (scaled - levelRef.current) * 0.5
            : levelRef.current + (scaled - levelRef.current) * 0.12;
        setLevel(levelRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setActive(false);
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { level, active, available, start, stop };
}
