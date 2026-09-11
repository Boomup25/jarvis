"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactorOrb } from "@/components/ReactorOrb";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
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
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Access denied.");
        setBusy(false);
        return;
      }
      window.location.assign(params.get("next") || "/");
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xs space-y-4 text-center">
      <ReactorOrb state="idle" className="mx-auto size-28" />

      <div>
        <h1 className="text-lg font-semibold tracking-[0.3em]">JARVIS</h1>
        <p className="readout mt-1">Authentication required</p>
      </div>

      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="username"
        className="w-full border border-edge bg-void/60 px-4 py-3 text-center text-frost placeholder:text-mist/50 focus:border-arc/60 focus:outline-none"
      />

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        className="w-full border border-edge bg-void/60 px-4 py-3 text-center tracking-widest text-frost placeholder:tracking-normal placeholder:text-mist/50 focus:border-arc/60 focus:outline-none"
      />

      {error && <p className="text-[0.8rem] text-ember">{error}</p>}

      <button
        type="submit"
        disabled={busy || !username || !password}
        className="notch-tr w-full bg-arc py-3 text-sm font-semibold text-void transition-opacity disabled:opacity-40"
      >
        {busy ? "Verifying…" : "Enter"}
      </button>

      <p className="readout pt-2">
        Have an invite?{" "}
        <Link href="/signup" className="text-arc hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex h-full items-center justify-center px-6">
      <Suspense fallback={<ReactorOrb state="idle" className="size-28" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
