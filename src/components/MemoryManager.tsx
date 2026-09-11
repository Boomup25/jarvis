"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BrainIcon, PinIcon, PlusIcon, TrashIcon } from "./Icons";

interface MemoryItem {
  id: string;
  content: string;
  category: string;
  importance: number;
  pinned: boolean;
  source: string;
}

interface ProfileInfo {
  displayName: string;
  assistantName: string;
  timezone: string;
  bio: string;
}

const CATEGORIES = [
  "identity",
  "fitness",
  "food",
  "preference",
  "schedule",
  "goal",
  "relationship",
  "work",
  "general",
];

export function MemoryManager({
  initialMemories,
  profile: initialProfile,
}: {
  initialMemories: MemoryItem[];
  profile: ProfileInfo;
}) {
  const router = useRouter();
  const [memories, setMemories] = useState(initialMemories);
  const [profile, setProfile] = useState(initialProfile);
  const [filter, setFilter] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftCategory, setDraftCategory] = useState("general");
  const [savingProfile, setSavingProfile] = useState<"idle" | "saving" | "saved">("idle");

  const grouped = useMemo(() => {
    const map = new Map<string, MemoryItem[]>();
    for (const m of memories) {
      if (filter && m.category !== filter) continue;
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [memories, filter]);

  const present = useMemo(
    () => CATEGORIES.filter((c) => memories.some((m) => m.category === c)),
    [memories]
  );

  async function addMemory(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, category: draftCategory, importance: 4 }),
    });
    if (res.ok) {
      const { memory } = await res.json();
      setMemories((prev) => [
        {
          id: memory.id,
          content: memory.content,
          category: memory.category,
          importance: memory.importance,
          pinned: memory.pinned,
          source: memory.source,
        },
        ...prev.filter((m) => m.id !== memory.id),
      ]);
      router.refresh();
    }
  }

  async function remove(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/memory/${id}`, { method: "DELETE" }).catch(() => {});
    router.refresh();
  }

  async function togglePin(item: MemoryItem) {
    const next = !item.pinned;
    setMemories((prev) => prev.map((m) => (m.id === item.id ? { ...m, pinned: next } : m)));
    await fetch(`/api/memory/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: next }),
    }).catch(() => {});
  }

  async function saveProfile() {
    setSavingProfile("saving");
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }).catch(() => {});
    setSavingProfile("saved");
    setTimeout(() => setSavingProfile("idle"), 1800);
    router.refresh();
  }

  return (
    <main className="h-full overflow-y-auto overscroll-contain px-4 pb-10 page-top lg:px-8 lg:page-top-wide">
      <div className="mx-auto w-full max-w-lg md:max-w-2xl lg:max-w-6xl">
      <div className="flex items-center gap-3">
        <BrainIcon className="size-6 text-violet" />
        <div>
          <h1 className="text-xl font-semibold">Memory</h1>
          <p className="text-[0.78rem] text-mist">{memories.length} things JARVIS knows about you.</p>
        </div>
      </div>

      {/* Identity is a short form that never grows; the memory list is the part
          that does. Side by side from lg so neither pushes the other down. */}
      <div className="lg:mt-2 lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-7">
      <section className="mt-5 rounded-2xl glass p-4 lg:sticky lg:top-0">
        <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-mist">Identity</h2>
        <div className="mt-3 space-y-2.5">
          <Field
            label="It calls you"
            value={profile.displayName}
            onChange={(v) => setProfile({ ...profile, displayName: v })}
          />
          <Field
            label="You call it"
            value={profile.assistantName}
            onChange={(v) => setProfile({ ...profile, assistantName: v })}
          />
          <Field
            label="Timezone"
            value={profile.timezone}
            onChange={(v) => setProfile({ ...profile, timezone: v })}
          />
          <label className="block">
            <span className="text-[0.7rem] text-mist">About you</span>
            <textarea
              value={profile.bio}
              onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
              rows={3}
              placeholder="Anything you want it to always keep in mind."
              className="mt-1 w-full resize-none rounded-lg border border-edge bg-abyss/70 px-3 py-2 text-[0.85rem] focus:border-arc/50 focus:outline-none"
            />
          </label>
          <button
            onClick={saveProfile}
            disabled={savingProfile === "saving"}
            className="w-full rounded-lg bg-arc/90 py-2.5 text-[0.8rem] font-semibold text-void disabled:opacity-50"
          >
            {savingProfile === "saved" ? "Saved" : savingProfile === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      <div className="min-w-0">
      <form onSubmit={addMemory} className="mt-5 flex gap-2 lg:mt-5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Teach it something…"
          className="flex-1 rounded-xl border border-edge bg-abyss/70 px-3.5 py-2.5 text-[0.86rem] placeholder:text-mist/60 focus:border-arc/50 focus:outline-none"
        />
        <select
          value={draftCategory}
          onChange={(e) => setDraftCategory(e.target.value)}
          className="rounded-xl border border-edge bg-abyss/70 px-2 text-[0.75rem] text-mist focus:outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Add memory"
          className="rounded-xl bg-arc px-3.5 text-void disabled:opacity-30"
        >
          <PlusIcon className="size-4" />
        </button>
      </form>

      {present.length > 1 && (
        <div className="-mx-4 mt-4 overflow-x-auto px-4">
          <div className="flex gap-2 pb-1">
            <Chip active={!filter} onClick={() => setFilter(null)} label="All" />
            {present.map((c) => (
              <Chip key={c} active={filter === c} onClick={() => setFilter(c)} label={c} />
            ))}
          </div>
        </div>
      )}

      {memories.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-edge px-4 py-10 text-center text-[0.8rem] text-mist">
          Nothing learned yet. Talk to it — it picks things up on its own.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {grouped.map(([category, items]) => (
            <section key={category}>
              <h2 className="text-[0.68rem] uppercase tracking-[0.18em] text-mist">{category}</h2>
              <ul className="mt-2 space-y-1.5 xl:grid xl:grid-cols-2 xl:gap-1.5 xl:space-y-0">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="group flex items-start gap-2.5 rounded-xl border border-edge bg-panel/50 px-3 py-2.5"
                  >
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full"
                      style={{ background: importanceColor(item.importance) }}
                      title={`Importance ${item.importance}/5`}
                    />
                    <span className="flex-1 text-[0.85rem] leading-snug">{item.content}</span>
                    <button
                      onClick={() => togglePin(item)}
                      aria-label={item.pinned ? "Unpin" : "Pin"}
                      className={`shrink-0 transition-colors ${item.pinned ? "text-gold" : "text-mist/40 hover:text-mist"}`}
                    >
                      <PinIcon className="size-3.5" />
                    </button>
                    <button
                      onClick={() => remove(item.id)}
                      aria-label="Forget this"
                      className="shrink-0 text-mist/40 transition-colors hover:text-ember"
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      </div>
      </div>
    </div>
    </main>
  );
}

function importanceColor(n: number) {
  if (n >= 5) return "var(--color-ember)";
  if (n === 4) return "var(--color-gold)";
  if (n === 3) return "var(--color-arc)";
  return "var(--color-mist)";
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[0.7rem] text-mist">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-edge bg-abyss/70 px-3 py-2 text-[0.85rem] focus:border-arc/50 focus:outline-none"
      />
    </label>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-[0.75rem] capitalize transition-colors ${
        active ? "border-violet/50 bg-violet/12 text-violet" : "border-edge text-mist hover:text-frost"
      }`}
    >
      {label}
    </button>
  );
}
