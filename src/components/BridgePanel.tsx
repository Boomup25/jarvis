"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, PlusIcon, TrashIcon, XIcon } from "./Icons";

interface Device {
  id: string;
  name: string;
  platform: string;
  capabilities: string[];
  roots: string[];
  active: boolean;
  online: boolean;
  lastSeenAt: string | null;
}

interface LogRow {
  id: string;
  capability: string;
  status: string;
  error: string;
  summary: string;
  createdAt: string;
  device: { id: string; name: string } | null;
}

type Lock = {
  configured: boolean;
  unlocked: boolean;
  remainingMs: number;
  unlockMinutes: number;
};

const STATUS_TONE: Record<string, string> = {
  ok: "text-jade",
  error: "text-ember",
  denied: "text-gold",
  pending: "text-mist",
  sent: "text-arc",
};

/**
 * The bridge, behind its own passphrase.
 *
 * Shows nothing useful until unlocked — no machine names, no folders, no log.
 * Someone who finds an open browser learns only that a bridge exists.
 */
export function BridgePanel() {
  const [lock, setLock] = useState<Lock | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);

  const [passphrase, setPassphrase] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [copied, setCopied] = useState(false);

  const readLock = useCallback(async () => {
    const res = await fetch("/api/bridge/unlock").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (res) setLock(res);
    return res as Lock | null;
  }, []);

  const loadUnlocked = useCallback(async () => {
    const [d, l] = await Promise.all([
      fetch("/api/bridge/devices").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/bridge/log?limit=25").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (d) setDevices(d.devices ?? []);
    if (l) setLog(l.commands ?? []);
  }, []);

  useEffect(() => {
    void readLock().then((state) => {
      if (state?.unlocked) void loadUnlocked();
    });
  }, [readLock, loadUnlocked]);

  // Count the unlock down and lock the panel the moment it lapses, rather than
  // leaving a stale "unlocked" UI that only fails on the next request.
  useEffect(() => {
    if (!lock?.unlocked) return;
    const timer = setInterval(() => {
      setLock((prev) => {
        if (!prev?.unlocked) return prev;
        const remainingMs = prev.remainingMs - 1000;
        if (remainingMs <= 0) {
          setDevices([]);
          setLog([]);
          setNewToken(null);
          return { ...prev, unlocked: false, remainingMs: 0 };
        }
        return { ...prev, remainingMs };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lock?.unlocked]);

  async function submit(action: "unlock" | "set") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bridge/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "set" ? { action, passphrase, accountPassword } : { action, passphrase }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That didn't work.");
        return;
      }
      setPassphrase("");
      setAccountPassword("");
      setConfirm("");
      await readLock();
      await loadUnlocked();
    } finally {
      setBusy(false);
    }
  }

  async function lockNow() {
    await fetch("/api/bridge/unlock", { method: "DELETE" }).catch(() => {});
    setDevices([]);
    setLog([]);
    setNewToken(null);
    await readLock();
  }

  async function pair() {
    setBusy(true);
    try {
      const res = await fetch("/api/bridge/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deviceName || "My computer" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNewToken(data.token);
        setDeviceName("");
        await loadUnlocked();
      } else {
        setError(data.error ?? "Couldn't pair.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setDevices((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/bridge/devices?id=${id}`, { method: "DELETE" }).catch(() => {});
    await loadUnlocked();
  }

  if (!lock) return null;

  const minutes = Math.floor(lock.remainingMs / 60000);
  const seconds = Math.floor((lock.remainingMs % 60000) / 1000);

  /* ---- not configured: first-time setup ----------------------------- */
  if (!lock.configured) {
    return (
      <Shell>
        <p className="text-[0.78rem] leading-relaxed text-mist">
          The bridge lets JARVIS reach a computer of yours. It gets its own passphrase,
          separate from your login — being signed in is not enough to command your machine.
        </p>
        <Field label="Your account password" value={accountPassword} onChange={setAccountPassword} type="password" />
        <Field label="New bridge passphrase (10+ characters)" value={passphrase} onChange={setPassphrase} type="password" />
        <Field label="Confirm passphrase" value={confirm} onChange={setConfirm} type="password" />
        {error && <p className="text-[0.75rem] text-ember">{error}</p>}
        <button
          onClick={() => submit("set")}
          disabled={busy || !passphrase || passphrase !== confirm || !accountPassword}
          className="notch-tr w-full bg-arc py-2.5 text-[0.8rem] font-semibold text-void disabled:opacity-40"
        >
          {busy ? "Setting…" : "Arm the bridge"}
        </button>
        <p className="text-[0.68rem] leading-snug text-mist">
          You&rsquo;ll type this again on your computer — it&rsquo;s what encrypts the
          machine&rsquo;s token on disk.
        </p>
      </Shell>
    );
  }

  /* ---- configured but locked ---------------------------------------- */
  if (!lock.unlocked) {
    return (
      <Shell>
        <p className="text-[0.78rem] text-mist">
          Locked. Enter the bridge passphrase to manage machines.
        </p>
        <Field label="Bridge passphrase" value={passphrase} onChange={setPassphrase} type="password"
          onEnter={() => void submit("unlock")} />
        {error && <p className="text-[0.75rem] text-ember">{error}</p>}
        <button
          onClick={() => void submit("unlock")}
          disabled={busy || !passphrase}
          className="notch-tr w-full bg-arc py-2.5 text-[0.8rem] font-semibold text-void disabled:opacity-40"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </Shell>
    );
  }

  /* ---- unlocked ------------------------------------------------------ */
  return (
    <Shell>
      <div className="flex items-center justify-between">
        <p className="readout text-jade">
          Unlocked · {minutes}:{String(seconds).padStart(2, "0")} left
        </p>
        <button onClick={lockNow} className="readout hover:text-ember">
          Lock now
        </button>
      </div>

      {newToken && (
        <div className="notch-tr border border-gold/40 bg-gold/[0.07] p-3">
          <p className="readout text-gold">Copy this now — it is shown once</p>
          <p className="mt-1.5 break-all font-mono text-[0.7rem] text-frost">{newToken}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(newToken).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="border border-edge px-3 py-1.5 text-[0.7rem] text-mist hover:text-frost"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => setNewToken(null)}
              aria-label="Dismiss"
              className="border border-edge px-3 py-1.5 text-[0.7rem] text-mist hover:text-frost"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div>
        <h3 className="readout">Machines</h3>
        {devices.length === 0 ? (
          <p className="mt-1.5 border border-dashed border-edge px-3 py-4 text-center text-[0.75rem] text-mist">
            None paired yet.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {devices.map((d) => (
              <li key={d.id} className="border border-edge bg-panel/40 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${d.online ? "live-dot bg-jade" : "bg-edge"}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.85rem]">{d.name}</span>
                  <span className="readout shrink-0">{d.online ? "online" : "offline"}</span>
                  <button
                    onClick={() => revoke(d.id)}
                    aria-label={`Revoke ${d.name}`}
                    className="shrink-0 text-mist/50 transition-colors hover:text-ember"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </div>
                {d.roots.length > 0 && (
                  <p className="readout mt-1 truncate normal-case tracking-normal">
                    {d.roots.join(" · ")}
                  </p>
                )}
                {d.capabilities.length > 0 && (
                  <p className="readout mt-0.5 truncate">{d.capabilities.join(" ")}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="Name this machine"
          className="flex-1 border border-edge bg-void/60 px-3 py-2 text-[0.8rem] placeholder:text-mist/50 focus:border-arc/50 focus:outline-none"
        />
        <button
          onClick={pair}
          disabled={busy}
          aria-label="Pair a machine"
          className="notch-tr bg-arc px-4 text-void disabled:opacity-40"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>

      <div>
        <h3 className="readout">Recent commands</h3>
        {log.length === 0 ? (
          <p className="mt-1.5 border border-dashed border-edge px-3 py-4 text-center text-[0.75rem] text-mist">
            Nothing sent yet.
          </p>
        ) : (
          <ul className="mt-1.5 max-h-52 space-y-1 overflow-y-auto">
            {log.map((row) => (
              <li key={row.id} className="flex items-start gap-2 border border-edge bg-panel/40 px-2.5 py-2">
                <span className={`readout shrink-0 ${STATUS_TONE[row.status] ?? "text-mist"}`}>
                  {row.status}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[0.72rem]">{row.capability}</span>
                  {(row.summary || row.error) && (
                    <span className="readout mt-0.5 block truncate normal-case tracking-normal">
                      {row.error || row.summary}
                    </span>
                  )}
                </span>
                <span className="readout shrink-0">
                  {new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
                    new Date(row.createdAt)
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details>
        <summary className="cursor-pointer text-[0.7rem] text-mist hover:text-frost">
          Change the bridge passphrase
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-[0.68rem] leading-snug text-gold">
            Changing it revokes every paired machine — their stored tokens were encrypted
            with the old one.
          </p>
          <Field label="Account password" value={accountPassword} onChange={setAccountPassword} type="password" />
          <Field label="New passphrase" value={passphrase} onChange={setPassphrase} type="password" />
          <Field label="Confirm" value={confirm} onChange={setConfirm} type="password" />
          <button
            onClick={() => submit("set")}
            disabled={busy || !passphrase || passphrase !== confirm || !accountPassword}
            className="w-full border border-edge py-2 text-[0.75rem] text-mist hover:text-frost disabled:opacity-40"
          >
            Change passphrase
          </button>
        </div>
      </details>

      {error && <p className="text-[0.75rem] text-ember">{error}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-mist">
        <CheckIcon className="size-3.5" />
        Bridge
      </div>
      <div className="mt-2 space-y-2.5">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className="text-[0.7rem] text-mist">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        className="mt-1 w-full border border-edge bg-void/60 px-3 py-2 text-[0.82rem] focus:border-arc/50 focus:outline-none"
      />
    </label>
  );
}

export { XIcon };
