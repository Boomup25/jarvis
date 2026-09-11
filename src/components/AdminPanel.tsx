"use client";

import { useCallback, useEffect, useState } from "react";
import { PlusIcon, TrashIcon, CheckIcon } from "./Icons";

interface Invite {
  id: string;
  code: string;
  note: string;
  usedByUsername: string | null;
  expiresAt: string | null;
  status: "open" | "used" | "expired";
}

interface Account {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  monthlyQuota: number;
  lastSeenAt: string | null;
  usage: Record<string, number>;
}

export function AdminPanel() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [users, setUsers] = useState<Account[]>([]);
  const [period, setPeriod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [inviteRes, userRes] = await Promise.all([
      fetch("/api/invites").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/users").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (inviteRes) setInvites(inviteRes.invites ?? []);
    if (userRes) {
      setUsers(userRes.users ?? []);
      setPeriod(userRes.period ?? "");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createInvite() {
    setBusy(true);
    try {
      await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      setNote("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setInvites((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/invites?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function setQuota(id: string, monthlyQuota: number) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, monthlyQuota } : u)));
    await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, monthlyQuota }),
    }).catch(() => {});
  }

  async function toggleActive(user: Account) {
    const active = !user.active;
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, active } : u)));
    await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, active }),
    }).catch(() => {});
  }

  async function share(invite: Invite) {
    const url = `${window.location.origin}/signup?code=${invite.code}`;
    try {
      // The share sheet is the natural thing on a phone; clipboard elsewhere.
      if (navigator.share) await navigator.share({ title: "JARVIS invite", url });
      else await navigator.clipboard.writeText(url);
      setCopied(invite.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <div className="mt-6 space-y-7 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8 lg:space-y-0">
      {/* Invites on the left, accounts on the right — they're read together. */}
      <div className="space-y-7">
      <section>
        <h2 className="readout">Create an invite</h2>
        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who's it for?"
            className="flex-1 border border-edge bg-void/60 px-3 py-2.5 text-[0.85rem] placeholder:text-mist/50 focus:border-arc/50 focus:outline-none"
          />
          <button
            onClick={createInvite}
            disabled={busy}
            aria-label="Create invite"
            className="notch-tr bg-arc px-4 text-void disabled:opacity-40"
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
        <p className="readout mt-1.5">Codes expire after 14 days and work once.</p>
      </section>

      {invites.length > 0 && (
        <section>
          <h2 className="readout">Invites</h2>
          <ul className="mt-2 space-y-1.5">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex items-center gap-3 border border-edge bg-panel/40 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[0.82rem] tracking-wider">{invite.code}</p>
                  <p className="readout mt-0.5">
                    {invite.status === "used"
                      ? `used by ${invite.usedByUsername}`
                      : invite.status === "expired"
                        ? "expired"
                        : invite.note || "unused"}
                  </p>
                </div>

                {invite.status === "open" && (
                  <>
                    <button
                      onClick={() => share(invite)}
                      className="border border-edge px-2.5 py-1.5 text-[0.7rem] text-mist transition-colors hover:text-arc"
                    >
                      {copied === invite.id ? "Copied" : "Share"}
                    </button>
                    <button
                      onClick={() => revoke(invite.id)}
                      aria-label="Revoke invite"
                      className="text-mist/50 transition-colors hover:text-ember"
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </>
                )}
                {invite.status === "used" && <CheckIcon className="size-4 text-jade" />}
              </li>
            ))}
          </ul>
        </section>
      )}

      </div>

      <div className="space-y-7">
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="readout">Accounts</h2>
          <span className="readout">{period}</span>
        </div>

        <ul className="mt-2 space-y-2">
          {users.map((user) => {
            const used = user.usage.chat ?? 0;
            const pct = user.monthlyQuota > 0 ? Math.min(100, (used / user.monthlyQuota) * 100) : 0;
            return (
              <li key={user.id} className="border border-edge bg-panel/40 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.88rem] font-medium">
                      {user.displayName}
                      {user.role === "owner" && <span className="readout ml-2 text-gold">owner</span>}
                      {!user.active && <span className="readout ml-2 text-ember">off</span>}
                    </p>
                    <p className="readout mt-0.5">
                      @{user.username} · {used} messages
                      {user.monthlyQuota > 0 ? ` of ${user.monthlyQuota}` : " · unlimited"}
                    </p>
                  </div>

                  {user.role !== "owner" && (
                    <button
                      onClick={() => toggleActive(user)}
                      className="border border-edge px-2.5 py-1.5 text-[0.68rem] text-mist transition-colors hover:text-frost"
                    >
                      {user.active ? "Disable" : "Enable"}
                    </button>
                  )}
                </div>

                {user.monthlyQuota > 0 && (
                  <div className="mt-2 h-1 w-full bg-edge/60">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct > 85 ? "var(--color-ember)" : "var(--color-viz-3)",
                      }}
                    />
                  </div>
                )}

                {user.role !== "owner" && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="readout">Quota</span>
                    {[100, 200, 500, 1000].map((value) => (
                      <button
                        key={value}
                        onClick={() => setQuota(user.id, value)}
                        className={`border px-2 py-1 text-[0.68rem] transition-colors ${
                          user.monthlyQuota === value
                            ? "border-arc/50 bg-arc/10 text-arc"
                            : "border-edge text-mist hover:text-frost"
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="readout">Your data</h2>
        <a
          href="/api/export"
          className="mt-2 block border border-edge px-3 py-2.5 text-center text-[0.8rem] text-mist transition-colors hover:border-arc/40 hover:text-frost"
        >
          Download everything as JSON
        </a>
        <p className="mt-1.5 text-[0.72rem] leading-relaxed text-mist">
          Memories, pages, tasks, logs and conversations. Worth keeping a copy —
          the database is a single point of failure.
        </p>
      </section>
      </div>
    </div>
  );
}
