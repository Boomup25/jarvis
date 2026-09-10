"use client";

import { ArcReactor } from "@/components/Icons";

export default function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <ArcReactor className="size-14 text-ember/70" />
      <p className="text-[0.95rem]">Something went wrong on my end.</p>
      <p className="max-w-sm text-[0.76rem] text-mist">{error.message}</p>
      <button onClick={reset} className="rounded-full bg-arc px-5 py-2 text-[0.8rem] font-semibold text-void">
        Try again
      </button>
    </main>
  );
}
