"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SearchIcon, PAGE_ICONS, BrainIcon, ChatIcon } from "./Icons";

interface Hit {
  kind: "page" | "memory" | "conversation";
  id: string;
  title: string;
  snippet: string;
  url: string;
  when: string;
  score: number;
}

const KIND_LABEL = { page: "Page", memory: "Memory", conversation: "Chat" } as const;

/** Search across pages, memories and conversations at once. */
export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Autofocus is right here: the sheet exists only to be typed into.
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    // Debounced — every keystroke hitting the database would be wasteful and
    // the results would race each other back.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setHits(data?.hits ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-void/85 backdrop-blur-sm" />

      <div className="safe-top relative mx-auto flex h-full w-full max-w-lg flex-col px-4 pt-4">
        <div className="relative shrink-0">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search everything"
            className="w-full border border-edge bg-abyss/90 py-3 pl-9 pr-16 text-[0.95rem] placeholder:text-mist/50 focus:border-arc/50 focus:outline-none"
          />
          <button
            onClick={onClose}
            className="readout absolute right-3 top-1/2 -translate-y-1/2 hover:text-frost"
          >
            Esc
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-3">
          {query.trim().length < 2 && (
            <p className="readout py-8 text-center">
              Pages, memories and past conversations
            </p>
          )}

          {query.trim().length >= 2 && !loading && hits.length === 0 && (
            <p className="py-8 text-center text-[0.82rem] text-mist">
              Nothing matches “{query.trim()}”.
            </p>
          )}

          {loading && hits.length === 0 && <p className="readout py-8 text-center">Searching</p>}

          <ul className="space-y-1.5">
            {hits.map((hit) => {
              const Icon =
                hit.kind === "page"
                  ? PAGE_ICONS.note
                  : hit.kind === "memory"
                    ? BrainIcon
                    : ChatIcon;
              return (
                <li key={`${hit.kind}-${hit.id}`}>
                  <Link
                    href={hit.url}
                    onClick={onClose}
                    className="flex items-start gap-3 border border-edge bg-panel/50 px-3 py-2.5 transition-colors hover:border-arc/40"
                  >
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-arc" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.86rem] font-medium capitalize">{hit.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[0.74rem] leading-snug text-mist">
                        {hit.snippet}
                      </p>
                    </div>
                    <span className="readout shrink-0">{KIND_LABEL[hit.kind]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
