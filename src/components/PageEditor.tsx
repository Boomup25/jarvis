"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "./Markdown";
import { CheckIcon, XIcon } from "./Icons";

/**
 * Edit a saved page in place.
 *
 * Changing one weight in a workout shouldn't mean asking JARVIS to rewrite the
 * whole thing — that was the friction on the feature you use most.
 */
export function PageEditor({
  slug,
  initialTitle,
  initialSummary,
  initialContent,
}: {
  slug: string;
  initialTitle: string;
  initialSummary: string;
  initialContent: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    title !== initialTitle || summary !== initialSummary || content !== initialContent;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, summary, contentMd: content }),
      });
      if (!res.ok) throw new Error("Save failed");
      setEditing(false);
      router.refresh();
    } catch {
      setError("Couldn't save. Your changes are still here — try again.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    // Only warn when there's something to lose.
    if (dirty && !confirm("Discard your changes?")) return;
    setTitle(initialTitle);
    setSummary(initialSummary);
    setContent(initialContent);
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    return (
      <>
        <article className="mt-6 border border-edge bg-panel/40 p-4">
          <Markdown>{initialContent}</Markdown>
        </article>
        <button
          onClick={() => setEditing(true)}
          className="mt-3 w-full border border-edge py-2.5 text-[0.8rem] text-mist transition-colors hover:border-arc/40 hover:text-frost"
        >
          Edit this page
        </button>
      </>
    );
  }

  return (
    <div className="mt-6 space-y-2.5">
      <label className="block">
        <span className="readout">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full border border-edge bg-void/60 px-3 py-2 text-[0.95rem] focus:border-arc/50 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="readout">Summary</span>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One line describing it"
          className="mt-1 w-full border border-edge bg-void/60 px-3 py-2 text-[0.82rem] placeholder:text-mist/50 focus:border-arc/50 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="readout">Content · Markdown</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={20}
          spellCheck={false}
          className="mt-1 w-full resize-y border border-edge bg-void/60 px-3 py-2.5 font-mono text-[0.78rem] leading-relaxed focus:border-arc/50 focus:outline-none"
        />
      </label>

      {error && (
        <p className="border border-ember/35 bg-ember/[0.07] px-3 py-2 text-[0.78rem] text-ember">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="notch-tr flex flex-1 items-center justify-center gap-2 bg-arc py-2.5 text-[0.8rem] font-semibold text-void disabled:opacity-40"
        >
          <CheckIcon className="size-4" />
          {saving ? "Saving…" : dirty ? "Save" : "No changes"}
        </button>
        <button
          onClick={cancel}
          className="border border-edge px-4 py-2.5 text-mist transition-colors hover:text-frost"
          aria-label="Cancel editing"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
