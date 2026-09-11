"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

/**
 * The reactor.
 *
 * A point cloud on a sphere, projected to 2D with cheap perspective, wrapped in
 * three tilted rings. It breathes on a slow sine at rest and inflates with your
 * voice when `level` is driven by real microphone amplitude.
 *
 * Everything animates off refs inside one requestAnimationFrame loop — prop
 * changes never trigger a React re-render, so a 60fps orb costs nothing in
 * reconciliation.
 */
export function ReactorOrb({
  state = "idle",
  level = 0,
  activityAt = 0,
  onPress,
  pressLabel = "Talk to JARVIS",
  className,
}: {
  state?: OrbState;
  level?: number;
  /**
   * Timestamp of the last detected speech event. Used on mobile, where we
   * can't open a second microphone stream for real amplitude — recognition
   * events are a coarse but honest signal that you're talking, and reading a
   * timestamp inside the animation loop keeps React out of the 60fps path.
   */
  activityAt?: number;
  /** When set, the orb becomes a button — tap it to talk. */
  onPress?: () => void;
  /** Accessible label for the button form. */
  pressLabel?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  const levelRef = useRef(level);
  const activityRef = useRef(activityAt);
  /** Timestamp of the last tap — drives the impact ripple. */
  const pressRef = useRef(0);

  stateRef.current = state;
  levelRef.current = level;
  activityRef.current = activityAt;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // --- geometry, generated once -------------------------------------
    const POINTS = 190;
    const points: { x: number; y: number; z: number }[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < POINTS; i++) {
      const y = 1 - (i / (POINTS - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      points.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
    }

    // Sparse edges between near neighbours — the "network" read, capped so
    // the draw stays cheap on a phone.
    const edges: [number, number][] = [];
    for (let i = 0; i < POINTS && edges.length < 260; i++) {
      for (let j = i + 1; j < POINTS && edges.length < 260; j++) {
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        const dz = points[i].z - points[j].z;
        if (dx * dx + dy * dy + dz * dz < 0.075) edges.push([i, j]);
      }
    }

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // --- animation state ----------------------------------------------
    let t = 0;
    let yaw = 0;
    let pitch = -0.25;
    let smoothLevel = 0;
    let smoothEnergy = 0;

    const draw = () => {
      const orbState = stateRef.current;
      t += reduceMotion ? 0.004 : 0.016;

      // Target energy per state. Listening tracks the mic; speaking gets a
      // synthetic envelope because the speech API exposes no amplitude.
      let target: number;
      switch (orbState) {
        case "listening": {
          if (levelRef.current > 0.01) {
            // Desktop: real microphone amplitude.
            target = 0.25 + levelRef.current * 0.95;
          } else {
            // Mobile: decay from the last speech event, with a little texture
            // so a steady voice doesn't look like a flat line.
            const since = Date.now() - activityRef.current;
            const recency = Math.max(0, 1 - since / 700);
            const texture = (Math.sin(t * 9.3) * 0.5 + Math.sin(t * 14.7) * 0.3) * 0.12;
            target = 0.22 + recency * (0.72 + texture);
          }
          break;
        }
        case "thinking":
          target = 0.42 + Math.sin(t * 5.5) * 0.12 + Math.sin(t * 8.3) * 0.06;
          break;
        case "speaking":
          target = 0.4 + Math.abs(Math.sin(t * 6.1)) * 0.32 + Math.abs(Math.sin(t * 11.7)) * 0.14;
          break;
        default:
          target = 0.14 + Math.sin(t * 0.9) * 0.07; // breathing at rest
      }

      // A tap throws a short, sharp impulse into the energy so the orb visibly
      // reacts to being touched rather than just changing state a beat later.
      const sincePress = t > 0 ? Date.now() - pressRef.current : Infinity;
      const impulse = pressRef.current ? Math.max(0, 1 - sincePress / 420) : 0;
      target += impulse * 0.75;

      smoothLevel += (levelRef.current - smoothLevel) * 0.25;
      smoothEnergy += (target - smoothEnergy) * (orbState === "listening" ? 0.32 : 0.09);
      const energy = Math.max(0, Math.min(1.35, smoothEnergy));

      const spin = orbState === "thinking" ? 0.028 : orbState === "idle" ? 0.0035 : 0.009;
      yaw += reduceMotion ? spin * 0.15 : spin;
      pitch = -0.25 + Math.sin(t * 0.4) * 0.16;

      const cx = width / 2;
      const cy = height / 2;
      const base = Math.min(width, height) / 2;
      const radius = base * (0.56 + energy * 0.14);

      ctx.clearRect(0, 0, width, height);

      // --- core glow ---------------------------------------------------
      const coreR = radius * (0.2 + energy * 0.16);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.5);
      glow.addColorStop(0, `rgba(190, 245, 255, ${0.5 + energy * 0.4})`);
      glow.addColorStop(0.12, `rgba(79, 216, 255, ${0.34 + energy * 0.3})`);
      glow.addColorStop(0.4, `rgba(79, 216, 255, ${0.09 + energy * 0.1})`);
      glow.addColorStop(1, "rgba(79, 216, 255, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226, 250, 255, ${0.75 + energy * 0.25})`;
      ctx.fill();

      // --- rings -------------------------------------------------------
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);

      for (let r = 0; r < 3; r++) {
        const tilt = (r / 3) * Math.PI + t * (r === 1 ? -0.13 : 0.09);
        const ringR = radius * (0.82 + r * 0.11);
        ctx.beginPath();
        for (let a = 0; a <= 64; a++) {
          const ang = (a / 64) * Math.PI * 2;
          // point on a tilted circle, then the shared world rotation
          let px = Math.cos(ang) * ringR;
          let py = Math.sin(ang) * ringR * Math.cos(tilt);
          let pz = Math.sin(ang) * ringR * Math.sin(tilt);

          const x1 = px * cosY - pz * sinY;
          const z1 = px * sinY + pz * cosY;
          const y1 = py * cosP - z1 * sinP;
          const z2 = py * sinP + z1 * cosP;

          const scale = 320 / (320 + z2);
          const sx = cx + x1 * scale;
          const sy = cy + y1 * scale;
          if (a === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(79, 216, 255, ${0.1 + energy * 0.2})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // --- point cloud + edges ------------------------------------------
      const projected = points.map((p, i) => {
        // Jitter scales with voice, so louder speech makes the shell shimmer.
        const wobble = 1 + Math.sin(t * 2.4 + i * 0.7) * 0.035 * (0.4 + energy);
        const rr = radius * wobble;
        const px = p.x * rr;
        const py = p.y * rr;
        const pz = p.z * rr;

        const x1 = px * cosY - pz * sinY;
        const z1 = px * sinY + pz * cosY;
        const y1 = py * cosP - z1 * sinP;
        const z2 = py * sinP + z1 * cosP;

        const scale = 320 / (320 + z2);
        return { x: cx + x1 * scale, y: cy + y1 * scale, depth: (z2 + radius) / (radius * 2), scale };
      });

      ctx.lineWidth = 1;
      for (const [i, j] of edges) {
        const a = projected[i];
        const b = projected[j];
        const depth = (a.depth + b.depth) / 2;
        ctx.strokeStyle = `rgba(96, 214, 255, ${(0.04 + depth * 0.16) * (0.5 + energy)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        const size = (0.7 + p.depth * 1.5) * (0.75 + energy * 0.5);
        // A few points run gold at high energy — keeps it from reading flat.
        const gold = (i * 7919) % 11 === 0 && energy > 0.45;
        const alpha = (0.18 + p.depth * 0.6) * (0.6 + energy * 0.5);
        ctx.fillStyle = gold
          ? `rgba(255, 199, 90, ${Math.min(1, alpha * 1.1)})`
          : `rgba(150, 232, 255, ${Math.min(1, alpha)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- press ripple ---------------------------------------------------
      if (impulse > 0.02) {
        const ripple = 1 - impulse; // expands outward as the impulse decays
        ctx.beginPath();
        ctx.arc(cx, cy, radius * (0.9 + ripple * 0.7), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(140, 232, 255, ${impulse * 0.55})`;
        ctx.lineWidth = 2 * impulse + 0.5;
        ctx.stroke();
      }

      // --- listening sweep ----------------------------------------------
      if (orbState === "listening" || orbState === "thinking") {
        const sweep = (t * (orbState === "thinking" ? 1.6 : 0.8)) % (Math.PI * 2);
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.06, sweep, sweep + 0.85);
        ctx.strokeStyle = `rgba(79, 216, 255, ${0.35 + energy * 0.35})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const label =
    state === "listening"
      ? "Listening"
      : state === "thinking"
        ? "Thinking"
        : state === "speaking"
          ? "Speaking"
          : "Idle";

  const canvas = (
    <canvas ref={canvasRef} className={onPress ? "size-full" : className} role="img" aria-label={label} />
  );

  if (!onPress) return canvas;

  return (
    <button
      type="button"
      aria-label={pressLabel}
      onPointerDown={() => {
        pressRef.current = Date.now();
      }}
      onClick={onPress}
      className={`relative block cursor-pointer touch-manipulation transition-transform active:scale-95 ${className ?? ""}`}
    >
      {canvas}
    </button>
  );
}
