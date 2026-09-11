"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchIcon, TrashIcon, ChatIcon } from "./Icons";

interface Thread {
  id: string;
  title: string;
  updatedAt: string;
}

/**
 * The conversation list itself, with no chrome around it.
 *
 * Shared by the phone bottom-sheet and the desktop rail so the two can't drift
 * apart — the only difference between them is what wraps this.
 */
export function ConversationList({
  active,
  onPick,
  currentId,
  onAfterPick,
}: {
  /** When false the list stops fetching — the sheet is closed. */
  active: boolean;
  onPick: (id: string) => void;
  currentId?: string;
  onAfterPick?: () => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    fetch("/api/conversations")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setThreads(json?.conversations ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [active, currentId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, query]);

  const grouped = useMemo(() => {
    const now = Date.now();
    const buckets: Record<string, Thread[]> = { Today: [], "This week": [], Earlier: [] };
    for (const thread of filtered) {
      const age = now - new Date(thread.updatedAt).getTime();
      const bucket = age < 86_400_000 ? "Today" : age < 7 * 86_400_000 ? "This week" : "Earlier";
      buckets[bucket].push(thread);
    }
    return Object.entries(buckets).filter(([, list]) => list.length > 0);
  }, [filtered]);

  async function remove(id: string) {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/conversations?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <>
      <div className="shrink-0 px-4 pb-3">
        <p className="readout">Conversations · {threads.length}</p>
        <div className="relative mt-2">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full border border-edge bg-void/60 py-2.5 pl-9 pr-3 text-[0.85rem] placeholder:text-mist/50 focus:border-arc/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {loading && threads.length === 0 && <p className="readout py-8 text-center">Loading</p>}

        {!loading && filtered.length === 0 && (
          <p className="py-8 text-center text-[0.8rem] text-mist">
            {query ? `Nothing matches "${query}".` : "No conversations yet."}
          </p>
        )}

        {grouped.map(([label, list]) => (
          <section key={label} className="mb-4">
            <p className="readout mb-1.5">{label}</p>
            <ul className="space-y-1">
              {list.map((thread) => (
                <li key={thread.id} className="group flex items-stretch gap-px">
                  <button
                    onClick={() => {
                      onPick(thread.id);
                      onAfterPick?.();
                    }}
                    className={`flex min-w-0 flex-1 items-center gap-2.5 border px-3 py-2.5 text-left transition-colors ${
                      thread.id === currentId
                        ? "border-arc/45 bg-arc/[0.08]"
                        : "border-edge hover:border-arc/35"
                    }`}
                  >
                    <ChatIcon className="size-3.5 shrink-0 text-mist" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.84rem]">{thread.title}</span>
                      <span className="readout">
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(thread.updatedAt))}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => remove(thread.id)}
                    aria-label={`Delete ${thread.title}`}
                    className="border border-edge px-3 text-mist/50 transition-colors hover:border-ember/40 hover:text-ember"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/** Past conversations, as a bottom sheet. Used below xl. */
export function HistorySheet({
  open,
  onClose,
  onPick,
  currentId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  currentId?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-void/75 backdrop-blur-sm" />

      <div className="safe-bottom relative flex max-h-[85dvh] flex-col border-t border-edge bg-abyss/95 backdrop-blur-xl">
        <div className="shrink-0 pt-3">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-edge" />
        </div>
        <ConversationList active={open} onPick={onPick} currentId={currentId} onAfterPick={onClose} />
      </div>
    </div>
  );
}

/** The same list as a permanent desktop rail. */
export function HistoryRail({
  onPick,
  currentId,
}: {
  onPick: (id: string) => void;
  currentId?: string;
}) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l border-edge bg-abyss/40 pt-4 xl:flex">
      <ConversationList active onPick={onPick} currentId={currentId} />
    </aside>
  );
}
