"use client";

import { useEffect, useState } from "react";

const SCREENS = [
  {
    id: "brief",
    label: "Brief",
    title: "A calm daily command centre",
    description: "The real dashboard brings together your greeting, progress, tasks, saved pages, and patterns.",
    image: "/demo/brief.png",
  },
  {
    id: "chat",
    label: "JARVIS",
    title: "A focused voice-first conversation",
    description: "The conversation view keeps the reactor, wake phrase, transcript, and controls in one place.",
    image: "/demo/chat.png",
  },
  {
    id: "week",
    label: "Your week",
    title: "Progress you can actually review",
    description: "The weekly view turns workouts, saved work, and learned context into a readable overview.",
    image: "/demo/week.png",
  },
  {
    id: "library",
    label: "Library",
    title: "Everything JARVIS writes down",
    description: "Saved plans, workouts, recipes, and guides stay organized in a searchable personal library.",
    image: "/demo/library.png",
  },
] as const;

export function DemoGallery() {
  const [selected, setSelected] = useState<(typeof SCREENS)[number]["id"]>("brief");
  const [expanded, setExpanded] = useState(false);
  const screen = SCREENS.find((item) => item.id === selected) ?? SCREENS[0];

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  return (
    <section className="mb-5 border border-edge bg-void/30 p-4 sm:p-5">
      <div className="mb-4">
        <p className="readout text-arc">EXPLORE THE REAL APP</p>
        <h2 className="mt-1 text-lg font-semibold">See what JARVIS looks like when it is yours.</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-mist">
          These are representative screens from the full experience. The public demo only shows them; it cannot open, change, or read any private account data.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="JARVIS screens">
        {SCREENS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected === item.id}
            onClick={() => setSelected(item.id)}
            className={`border px-3 py-2 text-xs transition-colors ${
              selected === item.id
                ? "border-arc/70 bg-arc/10 text-arc"
                : "border-edge text-mist hover:border-arc/50 hover:text-frost"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-hidden border border-edge bg-abyss/70">
        <div className="border-b border-edge px-4 py-3">
          <p className="text-sm font-semibold text-frost">{screen.title}</p>
          <p className="mt-1 text-xs leading-5 text-mist">{screen.description}</p>
        </div>
        <div className="bg-[#05080f] p-2 sm:p-4">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="group block w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-arc"
            aria-label={`Expand ${screen.label} screen`}
          >
            <img
              src={screen.image}
              alt={`${screen.label} screen from JARVIS`}
              className="block h-auto max-h-[34rem] w-full object-contain object-top transition-opacity group-hover:opacity-80"
            />
            <span className="mt-2 block text-center text-[0.65rem] uppercase tracking-[0.18em] text-mist/70">
              Click to expand
            </span>
          </button>
        </div>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-void/95 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`${screen.label} screen enlarged`}
          onClick={() => setExpanded(false)}
        >
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute right-4 top-4 border border-edge bg-panel px-4 py-2 text-xs text-frost hover:border-arc/60 hover:text-arc sm:right-8 sm:top-8"
            aria-label="Close expanded image"
          >
            Close
          </button>
          <img
            src={screen.image}
            alt={`${screen.label} screen from JARVIS enlarged`}
            className="max-h-full max-w-full object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
