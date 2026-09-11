"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactorOrb } from "@/components/ReactorOrb";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Lets an invite be shared as a link: /signup?code=ABCD-EFGH-JKLM
  useEffect(() => {
    const fromLink = params.get("code");
    if (fromLink) setCode(fromLink.toUpperCase());
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, username, displayName, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Signup failed.");
        setBusy(false);
        return;
      }
      // Full navigation, not router.replace: client-side routing can outrun
      // the Set-Cookie header and the proxy bounces you straight back to login.
      window.location.assign("/");
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xs space-y-3 text-center">
      <ReactorOrb state="idle" className="mx-auto size-24" />

      <div>
        <h1 className="text-lg font-semibold tracking-[0.3em]">JARVIS</h1>
        <p className="readout mt-1">Invite required</p>
      </div>

      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="INVITE CODE"
        autoCapitalize="characters"
        autoCorrect="off"
        className="w-full border border-edge bg-void/60 px-4 py-3 text-center font-mono text-[0.85rem] tracking-[0.2em] text-frost placeholder:tracking-[0.1em] placeholder:text-mist/50 focus:border-arc/60 focus:outline-none"
      />

      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Your name"
        autoComplete="name"
        className="w-full border border-edge bg-void/60 px-4 py-3 text-center text-frost placeholder:text-mist/50 focus:border-arc/60 focus:outline-none"
      />

      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="username"
        className="w-full border border-edge bg-void/60 px-4 py-3 text-center text-frost placeholder:text-mist/50 focus:border-arc/60 focus:outline-none"
      />

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (8+ characters)"
        autoComplete="new-password"
        className="w-full border border-edge bg-void/60 px-4 py-3 text-center text-frost placeholder:text-mist/50 focus:border-arc/60 focus:outline-none"
      />

      {error && <p className="text-[0.8rem] leading-snug text-ember">{error}</p>}

      <button
        type="submit"
        disabled={busy || !code || !username || !password}
        className="notch-tr w-full bg-arc py-3 text-sm font-semibold text-void transition-opacity disabled:opacity-40"
      >
        {busy ? "Creating…" : "Create account"}
      </button>

      <p className="readout pt-1">
        <Link href="/login" className="text-arc hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export default function SignupPage() {
  return (
    <main className="flex h-full items-center justify-center overflow-y-auto px-6 py-8">
      <Suspense fallback={<ReactorOrb state="idle" className="size-24" />}>
        <SignupForm />
      </Suspense>
    </main>
  );
}
