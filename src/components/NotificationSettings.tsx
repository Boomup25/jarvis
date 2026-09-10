"use client";

import { useCallback, useEffect, useState } from "react";
import { BellIcon, CheckIcon } from "./Icons";

interface AgendaItem {
  kind: string;
  title: string;
  body: string;
}

interface Settings {
  pushEnabled?: boolean;
  briefHour?: number;
  quietFrom?: number;
  quietTo?: number;
  mutedKinds?: string[];
  lat?: number;
  lon?: number;
}

const KINDS = [
  { id: "brief", label: "Morning brief", note: "A summary at your chosen hour" },
  { id: "workout", label: "Training nudges", note: "When it's been a few days" },
  { id: "task", label: "Task deadlines", note: "Due today or overdue" },
  { id: "weather", label: "Weather", note: "Only when it affects outdoor plans" },
];

/** VAPID keys are base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  // Return the ArrayBuffer itself: PushManager wants a BufferSource, and a
  // Uint8Array over a possibly-shared buffer doesn't satisfy that type.
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

function isIOS() {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** iOS only permits Web Push for an app installed to the home screen. */
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function NotificationSettings() {
  const [supported, setSupported] = useState(true);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [preview, setPreview] = useState<AgendaItem[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const canPush = "serviceWorker" in navigator && "PushManager" in window;
    setSupported(canPush);
    // On iOS the APIs are simply absent until it's installed to the home screen.
    setNeedsInstall(isIOS() && !isStandalone());

    fetch("/api/push")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        setConfigured(json.configured);
        setPublicKey(json.publicKey);
      })
      .catch(() => {});

    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => json?.settings && setSettings(json.settings))
      .catch(() => {});

    if (canPush) {
      navigator.serviceWorker.getRegistration().then(async (reg) => {
        const existing = await reg?.pushManager.getSubscription();
        setSubscribed(Boolean(existing));
      });
    }
  }, []);

  const save = useCallback(async (patch: Settings) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }, []);

  async function enable() {
    setBusy(true);
    setStatus(null);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(
          permission === "denied"
            ? "Notifications are blocked. On iPhone: Settings → Notifications → JARVIS → Allow."
            : "Permission wasn't granted."
        );
        return;
      }

      if (!publicKey) {
        setStatus("Server has no VAPID keys configured.");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          label: navigator.userAgent.slice(0, 60),
        }),
      });
      if (!res.ok) throw new Error("Server rejected the subscription");

      await save({ pushEnabled: true });
      setSubscribed(true);
      setStatus("Enabled. Try the test below.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Couldn't enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      await save({ pushEnabled: false });
      setSubscribed(false);
      setStatus("Notifications off.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const json = await res.json();
      setStatus(
        res.ok
          ? json.delivered > 0
            ? `Sent to ${json.delivered} device${json.delivered === 1 ? "" : "s"}.`
            : "No active devices registered."
          : json.error ?? "Test failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview() {
    const res = await fetch("/api/agenda");
    if (!res.ok) return;
    const json = await res.json();
    setPreview(json.candidates ?? []);
  }

  function captureLocation() {
    if (!navigator.geolocation) return;
    setStatus("Getting location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void save({
          lat: Math.round(pos.coords.latitude * 100) / 100,
          lon: Math.round(pos.coords.longitude * 100) / 100,
        });
        setStatus("Location saved — weather is on.");
      },
      () => setStatus("Couldn't get location."),
      { timeout: 10000 }
    );
  }

  const muted = settings.mutedKinds ?? [];
  const toggleKind = (id: string) =>
    save({ mutedKinds: muted.includes(id) ? muted.filter((k) => k !== id) : [...muted, id] });

  return (
    <section>
      <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-mist">
        <BellIcon className="size-3.5" />
        Notifications
      </div>

      {needsInstall && (
        <p className="mt-2 rounded-lg border border-gold/30 bg-gold/[0.07] px-3 py-2 text-[0.72rem] leading-snug text-gold">
          On iPhone, notifications only work once this is added to your home screen.
          Tap Share → Add to Home Screen, then open it from there.
        </p>
      )}

      {!configured && (
        <p className="mt-2 rounded-lg border border-ember/30 bg-ember/[0.07] px-3 py-2 text-[0.72rem] leading-snug text-ember">
          The server has no VAPID keys. Generate a pair and set VAPID_PUBLIC_KEY and
          VAPID_PRIVATE_KEY.
        </p>
      )}

      {!supported && !needsInstall && (
        <p className="mt-2 text-[0.72rem] text-mist">This browser doesn&apos;t support push notifications.</p>
      )}

      {supported && configured && (
        <>
          <div className="mt-2 flex gap-2">
            <button
              onClick={subscribed ? disable : enable}
              disabled={busy}
              className={`flex-1 rounded-lg border py-2 text-[0.75rem] transition-colors disabled:opacity-50 ${
                subscribed ? "border-jade/40 text-jade" : "border-arc/50 bg-arc/10 text-arc"
              }`}
            >
              {busy ? "…" : subscribed ? "Enabled — tap to turn off" : "Enable notifications"}
            </button>
            {subscribed && (
              <button
                onClick={test}
                disabled={busy}
                className="rounded-lg border border-edge px-3 py-2 text-[0.75rem] text-mist disabled:opacity-50"
              >
                Test
              </button>
            )}
          </div>

          {status && <p className="mt-1.5 text-[0.68rem] leading-snug text-mist">{status}</p>}

          {subscribed && (
            <div className="mt-3 space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <NumberField
                  label="Brief at"
                  value={settings.briefHour ?? 7}
                  onChange={(v) => save({ briefHour: v })}
                />
                <NumberField
                  label="Quiet from"
                  value={settings.quietFrom ?? 22}
                  onChange={(v) => save({ quietFrom: v })}
                />
                <NumberField
                  label="Quiet until"
                  value={settings.quietTo ?? 7}
                  onChange={(v) => save({ quietTo: v })}
                />
              </div>

              <div className="space-y-1">
                {KINDS.map((kind) => {
                  const on = !muted.includes(kind.id);
                  return (
                    <button
                      key={kind.id}
                      onClick={() => toggleKind(kind.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg border border-edge px-2.5 py-2 text-left"
                    >
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                          on ? "border-arc bg-arc/20 text-arc" : "border-edge text-transparent"
                        }`}
                      >
                        <CheckIcon className="size-3" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.76rem]">{kind.label}</span>
                        <span className="block text-[0.64rem] text-mist">{kind.note}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={captureLocation}
                className="w-full rounded-lg border border-edge py-2 text-[0.72rem] text-mist"
              >
                {settings.lat != null ? "Update location for weather" : "Set location for weather"}
              </button>

              <details onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadPreview()}>
                <summary className="cursor-pointer text-[0.68rem] text-mist hover:text-frost">
                  What would it send right now?
                </summary>
                <div className="mt-1.5 space-y-1.5">
                  {preview.length === 0 ? (
                    <p className="text-[0.68rem] text-mist">
                      Nothing — no rule is worth interrupting you for at this hour.
                    </p>
                  ) : (
                    preview.map((item, i) => (
                      <div key={i} className="rounded-lg border border-edge px-2.5 py-2">
                        <p className="text-[0.74rem] font-medium">{item.title}</p>
                        <p className="text-[0.66rem] leading-snug text-mist">{item.body}</p>
                      </div>
                    ))
                  )}
                </div>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[0.62rem] text-mist">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 w-full rounded-lg border border-edge bg-abyss/70 px-1.5 py-1.5 text-[0.74rem] focus:border-arc/50 focus:outline-none"
      >
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {h === 0 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`}
          </option>
        ))}
      </select>
    </label>
  );
}
