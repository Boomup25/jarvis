"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, PinIcon, TrashIcon, ChatIcon } from "./Icons";

/** Footer actions on a saved page: mark it done, pin it, revise it, bin it. */
export function PageActions({
  slug,
  title,
  type,
  pinned,
}: {
  slug: string;
  title: string;
  type: string;
  pinned: boolean;
}) {
  const router = useRouter();
  const [isPinned, setIsPinned] = useState(pinned);
  const [logged, setLogged] = useState(false);
  const [busy, setBusy] = useState(false);

  const loggable = type === "workout" || type === "recipe";
  const logKind = type === "workout" ? "workout" : "meal";

  async function markDone() {
    setBusy(true);
    await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: logKind, pageSlug: slug, note: title }),
    }).catch(() => {});
    setLogged(true);
    setBusy(false);
    router.refresh();
  }

  async function togglePin() {
    const next = !isPinned;
    setIsPinned(next);
    await fetch(`/api/pages/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: next }),
    }).catch(() => setIsPinned(!next));
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
    setBusy(true);
    await fetch(`/api/pages/${slug}`, { method: "DELETE" }).catch(() => {});
    router.push("/pages");
    router.refresh();
  }

  return (
    <div className="mt-5 space-y-2">
      {loggable && (
        <button
          onClick={markDone}
          disabled={busy || logged}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[0.85rem] font-semibold transition-colors ${
            logged ? "bg-jade/15 text-jade" : "bg-arc text-void"
          }`}
        >
          <CheckIcon className="size-4" />
          {logged ? "Logged" : type === "workout" ? "Mark workout complete" : "Log this meal"}
        </button>
      )}

      <div className="flex gap-2">
        <Link
          href={`/chat?q=${encodeURIComponent(`Revise the "${title}" page (/pages/${slug}) — `)}`}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-edge py-2.5 text-[0.8rem] text-mist transition-colors hover:text-frost"
        >
          <ChatIcon className="size-4" />
          Revise
        </Link>
        <button
          onClick={togglePin}
          aria-label={isPinned ? "Unpin" : "Pin"}
          className={`rounded-xl border px-4 py-2.5 transition-colors ${
            isPinned ? "border-gold/40 text-gold" : "border-edge text-mist hover:text-frost"
          }`}
        >
          <PinIcon className="size-4" />
        </button>
        <button
          onClick={remove}
          aria-label="Delete page"
          className="rounded-xl border border-edge px-4 py-2.5 text-mist transition-colors hover:border-ember/40 hover:text-ember"
        >
          <TrashIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
