"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArcReactor } from "@/components/Icons";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Access denied.");
        setBusy(false);
        return;
      }
      router.replace(params.get("next") || "/");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xs space-y-5 text-center">
      <ArcReactor className="mx-auto size-20 text-arc drop-shadow-[0_0_30px_var(--color-arc)]" />
      <div>
        <h1 className="text-lg font-semibold tracking-[0.3em]">JARVIS</h1>
        <p className="mt-1 text-[0.78rem] text-mist">Authentication required.</p>
      </div>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Passphrase"
        autoFocus
        autoComplete="current-password"
        className="w-full rounded-xl border border-edge bg-abyss/70 px-4 py-3 text-center tracking-widest text-frost placeholder:tracking-normal placeholder:text-mist/60 focus:border-arc/60 focus:outline-none"
      />
      {error && <p className="text-[0.8rem] text-ember">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="w-full rounded-xl bg-arc py-3 text-sm font-semibold text-void transition-opacity disabled:opacity-40"
      >
        {busy ? "Verifying…" : "Enter"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-6">
      <Suspense fallback={<ArcReactor className="size-20 text-arc" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
