"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live microphone loudness, 0..1, for driving the orb.
 *
 * Runs its own getUserMedia stream alongside SpeechRecognition — they coexist
 * fine, and it's the only way to get real amplitude, since the speech API
 * exposes none. Fails soft: if permission is denied the orb just falls back to
 * its idle breathing rather than breaking dictation.
 */
export function useMicLevel() {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const levelRef = useRef(0);

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
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    if (streamRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const Ctx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
        // RMS around the 128 midpoint, scaled so normal speech lands near 0.5.
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const scaled = Math.min(1, rms * 4.5);
        // Fast attack, slow release — reads as responsive without flickering.
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

  return { level, active, start, stop };
}
